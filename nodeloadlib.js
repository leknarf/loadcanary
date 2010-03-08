var sys = require('sys');
var http = require('http');
var fs = require('fs');
var events = require('events');
var querystring = require('querystring');

var start = new Date().getTime();
var lastUid = 0;
var uid = function() { return lastUid++ };



// ------------------------------------
// Main HTTP load testing interface
// ------------------------------------
var TEST_DEFAULTS = {
    name: 'Debug test',                 // A descriptive name for the test
    host: 'localhost',                  // host and port specify where to connect
    port: 8080,                         //
    requestGenerator: null,             // Specify one of: requestGenerator, requestLoop, or (method, path, requestData)
    requestLoop: null,                  //   - A requestGenerator is a function that takes a http.Client param
    method: 'GET',                      //     and returns a http.ClientRequest.
    path: '/',                          //   - A requestLoop is a function that takes two params (loopFun, http.Client).
    requestData: null,                  //     It should call loopFun({req: http.ClientRequest, res: http.ClientResponse})
                                        //     after each operation to schedule the next iteration of requestLoop.
                                        //   - (method, path, requestData) specify a single URL to test
    numClients: 10,                     // Maximum number of concurrent executions of request loop
    numRequests: Infinity,              // Maximum number of iterations of request loop
    timeLimit: 120,                     // Maximum duration of test in seconds
    targetRps: Infinity,                // Number of times per second to execute request loop
    delay: 0,                           // Seconds before starting test
    successCodes: null,                 // List of success HTTP response codes. Failures are logged to the error log.
    stats: ['latency', 'result-codes'], // Specify list of: latency, result-codes, uniques, concurrency. Note that "uniques"
                                        // only shows up in summary report and requests must be made with traceableRequest().
                                        // Not doing so will result in reporting only 2 uniques.
    reportInterval: 2,                  // Seconds between each progress report
    reportFun: null,                    // Function called each reportInterval that takes a param, stats, which is a map of
                                        // { 'latency': Reportable(Histogram), 'result-codes': Reportable(ResultsCounter},
                                        // 'uniques': Reportable(Uniques), 'concurrency': Reportable(Peak) }
}
var RAMP_DEFAULTS = {
    test: null,                         // The test to ramp up, returned from from addTest()
    numberOfSteps: 10,                  // Number of steps in ramp
    timeLimit: 10,                      // The total number of seconds to ramp up
    rpsPerStep: 10,                     // The rps to add to the test at each step
    clientsPerStep: 1,                  // The number of connections to add to the test at each step.
    delay: 0                            // Number of seconds to wait before ramping up. 
}
var summaryStats = [];
var endTestTimeoutId;

addTest = function(spec) {
    function req(client) {
        if (spec.requestGenerator == null) {
            if ((spec.requestData != null) && (spec.method.search('^(PUT|POST)$') != -1)) {
                var body = spec.requestData;
            }
            return traceableRequest(spec.method, spec.path, { 'host': spec.host }, body);
        }
        return spec.requestGenerator(client);
    }
    
    defaults(spec, TEST_DEFAULTS);
    var monitored = spec.requestLoop;
    if (monitored == null) {
        monitored = requestGeneratorLoop(req);
    }

    var stats = {};
    if (spec.stats.indexOf('latency') >= 0) {
        var l = new Reportable(Histogram, spec.name + ': Latency', true);
        monitored = monitorLatenciesLoop(l, monitored);
        stats['latency'] = l;
    }
    if (spec.stats.indexOf('result-codes') >= 0) {
        var rc = new Reportable(ResultsCounter, spec.name + ': Result codes', true);
        monitored = monitorResultsLoop(rc, monitored);
        stats['result-codes'] = rc;
    }
    if (spec.stats.indexOf('concurrency') >= 0) {
        var conc = new Reportable(Peak, spec.name + ': Concurrency', true);
        monitored = monitorConcurrencyLoop(conc, monitored);
        stats['concurrency'] = conc;
    }
    if (spec.stats.indexOf('uniques') >= 0) {
        var uniq = new Reportable(Uniques, spec.name + ': Uniques', false);
        monitored = monitorUniqueUrlsLoop(uniq, monitored);
        stats['uniques'] = uniq;
    }
    if (spec.successCodes != null) {
        monitored = monitorHttpFailuresLoop(spec.successCodes, monitored);
    }

    var s = SCHEDULER.schedule({
        fun: monitored,
        argGenerator: function() { return http.createClient(spec.port, spec.host) },
        concurrency: spec.numClients,
        rps: spec.targetRps,
        duration: spec.timeLimit,
        numberOfTimes: spec.numRequests,
        delay: spec.delay
    });

    if (spec.reportInterval != null) {
        SCHEDULER.schedule({
            fun: progressReportLoop(stats, spec.reportFun),
            rps: 1/spec.reportInterval,
            delay: spec.reportInterval,
            monitored: false
        });
    }
    
    s.stats = stats;
    s.testspec = spec;
    summaryStats.push(stats);
    
    return s;
}

addRamp = function(spec) {
    defaults(spec, RAMP_DEFAULTS);
    var ramp = function() {
        SCHEDULER.schedule({
            fun: spec.test.fun,
            argGenerator: function() { return http.createClient(spec.test.testspec.port, spec.test.testspec.host) },
            rps: spec.rpsPerStep,
            concurrency: spec.clientsPerStep,
            monitored: false
        }).start();
    }
    return SCHEDULER.schedule({
        fun: funLoop(ramp),
        delay: spec.delay,
        duration: spec.timeLimit,
        rps: spec.numberOfSteps / spec.timeLimit,
        monitored: false
    });
}

startTests = function(callback, stayAliveAfterDone) {
    HTTP_REPORT.setText("");

    function finish() {
        qprint('done.\n');
        summaryReport(summaryStats);
        if (!stayAliveAfterDone) {
            // End process if no more tests are started within 3 seconds.
            endTestTimeoutId = setTimeout(endTest, 3000);
        }
        if (callback != null) {
            callback();
        }
    }
    SCHEDULER.startAll(finish);
}

runTest = function(spec, callback) {
    var t = addTest(spec);
    startTests(callback);
    return t;
}

endTest = function() {
    qputs("\nFinishing...");
    closeAllLogs();
    stopHttpServer();
    setTimeout(process.exit, 500);
}

setTestConfig = function(configType) {
    var refreshPeriod;
    if (configType == 'long') {
        refreshPeriod = 10000;
        TEST_DEFAULTS.reportInterval = 10;
    } else {
        refreshPeriod = 2000;
        TEST_DEFAULTS.reportInterval = 2;
    }
    if (typeof SUMMARY_HTML_REFRESH_PERIOD == "undefined") {
        SUMMARY_HTML_REFRESH_PERIOD = refreshPeriod;
    }
}
    
traceableRequest = function(client, method, path, headers, body) {
    if (headers != null && headers['content-length'] == null) {
        if (body == null) {
            headers['content-length'] = 0;
        } else {
            headers['content-length'] = body.length;
        }
    }

    var request = client.request(method, path, headers);

    // Current implementation (2/19/10) of http.js in node.js pushes header 
    // lines to request.output during client.request(). This is currently 
    // the only way to reliably get all the headers going over the wire.
    request.headerLines = request.output.slice();
    request.path = path;

    if (body != null) {
        request.write(body);
    }
    request.body = body;

    return request;
}

function defaults(spec, defaults) {
    for (var i in defaults) {
        if (spec[i] == null) {
            spec[i] = defaults[i];
        }
    }
}



// -----------------------------------------
// Scheduler for event-based loops
// -----------------------------------------
var JOB_DEFAULTS = {
    fun: null,                  // A function to execute which accepts the parameters (loopFun, args).
                                // The value of args is the return value of argGenerator() or the args
                                // parameter if argGenerator is null. The function must call 
                                // loopFun(results) when it completes.
    argGenerator: null,         // A function which is called once when the job is started. The return
                                // value is passed to fun as the "args" parameter. This is useful when
                                // concurrency > 1, and each "thread" should have its own args.
    args: null,                 // If argGenerator is NOT specified, then this is passed to the fun as "args".
    concurrency: 1,             // Number of concurrent calls of fun()
    rps: Infinity,              // Target number of time per second to call fun()
    duration: Infinity,         // Maximum duration of this job in seconds
    numberOfTimes: Infinity,    // Maximum number of times to call fun()
    delay: 0,                   // Seconds to wait before calling fun() for the first time
    monitored: true             // Does this job need to finish in order for SCHEDULER.startAll() to end?
};
Scheduler = function() {
    this.id=uid();
    this.jobs = [];
    this.running = false;
    this.callback = null;
}
Scheduler.prototype = {
    schedule: function(spec) {
        defaults(spec, JOB_DEFAULTS);
        var s = new Job(spec);
        this.addJob(s);
        return s;
    },
    addJob: function(s) {
        this.jobs.push(s);
    },
    startJob: function(s) {
        var scheduler = this;
        s.start(function() { scheduler.checkFinished() });
    },
    startAll: function(callback) {
        if (this.running)
            return;

        var len = this.jobs.length;
        for (var i = 0; i < len; i++) {
            if (!this.jobs[i].started) {
                this.startJob(this.jobs[i]);
            }
        }

        this.callback = callback;
        this.running = true;
    },
    stopAll: function() {
        for (var i in this.jobs) {
            this.jobs[i].stop();
        }
    },
    checkFinished: function() {
        for (var i in this.jobs) {
            if (this.jobs[i].monitored && !this.jobs[i].done) {
                return false;
            }
        }
        this.running = false;
        this.stopAll();
        this.jobs = [];

        if (this.callback != null) {
            // Clear out callback before calling it since function may actually call startAll() again.
            var oldCallback = this.callback;
            this.callback = null;
            oldCallback();
        }

        return true;
    }
}

function Job(spec) {
    this.id = uid();
    this.fun = spec.fun;
    this.args = spec.args;
    this.argGenerator = spec.argGenerator;
    this.concurrency = spec.concurrency;
    this.rps = spec.rps;
    this.duration = spec.duration;
    this.numberOfTimes = spec.numberOfTimes;
    this.delay = spec.delay;
    this.monitored = spec.monitored;

    this.callback = null;
    this.started = false;
    this.done = false;
    
    var job = this;
    this.warningTimeoutId = setTimeout(function() { qputs("WARN: a job" + job.id + " was not started; Job.start() called?") }, 3000);
    this.warningTimeoutId.id = this.id;
}
Job.prototype = {
    start: function(callback) {
        clearTimeout(this.warningTimeoutId); // Cancel "didn't start job" warning
        clearTimeout(endTestTimeoutId); // Do not end the process if loop is started

        if (this.fun == null)
            qputs("WARN: scheduling a null loop");
        if (this.started)
            return this;

        var job = this;
        var fun = this.fun;
        var conditions = [];

        for (var i = 1; i < this.concurrency; i++) {
            var clone = this.clone();
            clone.concurrency = 1;
            if (clone.numberOfTimes != null) {
                clone.numberOfTimes /= this.concurrency;
            }
            if (clone.rps != null) {
                clone.rps /= this.concurrency;
            }
            SCHEDULER.addJob(clone);
            SCHEDULER.startJob(clone);
        }
        if (this.rps != null && this.rps < Infinity) {
            var rps = this.rps;
            if (this.concurrency > 1) {
                rps /= this.concurrency;
            }
            fun = rpsLoop(rps, fun);
        }
        if (this.numberOfTimes != null && this.numberOfTimes < Infinity) {
            var numberOfTimes = this.numberOfTimes;
            if (this.concurrency > 1) {
                numberOfTimes /= this.concurrency;
            }
            conditions.push(maxExecutions(numberOfTimes));
        }
        if (this.duration != null && this.duration < Infinity) {
            var duration = this.duration;
            if (this.delay != null && this.delay > 0)
                duration += this.delay;
            conditions.push(timeLimit(duration));
        }
        if (this.argGenerator != null) {
            this.args = this.argGenerator();
        }

        this.callback = callback;
        this.loop = new ConditionalLoop(fun, this.args, conditions, this.delay);
        this.loop.start(function() {
            job.done = true;
            if (job.callback != null) {
                job.callback();
            }
        });
    },
    stop: function() {
        if (this.loop != null) {
            this.loop.stop();
        }
    },
    clone: function() {
        var job = this;
        var other = new Job({
            fun: job.fun,
            args: job.args,
            concurrency: job.concurrency,
            argGenerator: job.argGenerator,
            rps: job.rps,
            duration: job.duration,
            numberOfTimes: job.numberOfTimes,
            delay: job.delay,
            monitored: job.monitored
        });
        return other;
    },
}



// -----------------------------------------
// Event-based looping
// -----------------------------------------
ConditionalLoop = function(fun, args, conditions, delay) {
    this.fun = fun;
    this.args = args;
    this.conditions = (conditions == null) ? [] : conditions;
    this.delay = delay;
    this.stopped = true;
    this.callback = null;
}
ConditionalLoop.prototype = {
    checkConditions: function() {
        if (this.stopped) {
            return false;
        }
        for (var i = 0; i < this.conditions.length; i++) {
            if (!this.conditions[i]()) {
                return false;
            }
        }
        return true;
    },
    loop: function() {
        if (this.checkConditions()) {
            var loop = this;
            process.nextTick(function() { loop.fun(function() { loop.loop() }, loop.args) });
        } else {
            if (this.callback != null)
                this.callback();
        }
    },
    start: function(callback) {
        var loop = this;
        this.callback = callback;
        this.stopped = false;
        if (this.delay != null && this.delay > 0) {
            setTimeout(function() { loop.loop() }, this.delay * 1000);
        } else {
            this.loop();
        }
    },
    stop: function() {
        this.stopped = true;
    }
}

timeLimit = function(seconds) {
    var start = new Date();
    return function() { 
        return (seconds == Infinity) || ((new Date() - start) < (seconds * 1000));
    };
}

maxExecutions = function(numberOfTimes) {
    var counter = 0;
    return function() { 
        return (numberOfTimes == Infinity) || (counter++ < numberOfTimes)
    };
}

funLoop = function(fun) {
    return function(loopFun, args) {
        var result = fun(args);
        loopFun(result);
    }
}

rpsLoop = function(rps, fun) {
    var timeout = 1/rps * 1000;
    var finished = false;
    var lagging = false;
    var finishFun = function(loopFun) {
        finished = true;
        if (lagging) {
            loopFun();
        }
    };
    var wrapperFun = function(loopFun, client) {
        finished = false;
        if (timeout > 0) {
            setTimeout(function() { 
                if (!finished)
                    lagging = true; 
                else
                    loopFun();
            }, timeout);
            lagging = false;
        } else {
            lagging = true;
        }
        fun(function() { finishFun(loopFun) }, client);
    }
    return wrapperFun;
}

requestGeneratorLoop = function(generator) {
    return function(loopFun, client) {
        var request = generator(client);
        if (request == null) {
            qputs('WARN: HTTP request is null; did you forget to call return request?');
            loopfun(null);
        } else {
            request.addListener('response', function(response) {
                if (response == null) {
                    qputs('WARN: HTTP response is null; did you forget to call loopFun(response)?');
                }
                loopFun({req: request, res: response});
            });
            request.close();
        }
    }
}



// ------------------------------------
// Monitoring loops
// ------------------------------------
monitorLatenciesLoop = function(latencies, fun) {
    var startTime;
    var start = function() { startTime = new Date() };
    var finish = function() { latencies.put(new Date() - startTime) };
    return loopWrapper(fun, start, finish);
}

monitorResultsLoop = function(results, fun) {
    var finish = function(http) { results.put(http.res.statusCode) };
    return loopWrapper(fun, null, finish);
}

monitorByteReceivedLoop = function(bytesReceived, fun) {
    var finish = function(http) { 
        http.res.addListener('data', function(chunk) {
            bytesReceived.put(chunk.length);
        });
    };
    return loopWrapper(fun, null, finish);
}

monitorConcurrencyLoop = function(concurrency, fun) {
    var c = 0;
    var start = function() { c++; };
    var finish = function() { concurrency.put(c--) };
    return loopWrapper(fun, start, finish);
}

monitorRateLoop = function(rate, fun) {
    var finish = function() { rate.put() };
    return loopWrapper(fun, null, finish);
}

monitorHttpFailuresLoop = function(successCodes, fun, log) {
    if (log == null)
        log = ERROR_LOG;
    var finish = function(http) {
        var body = "";
        if (successCodes.indexOf(http.res.statusCode) < 0) {
            http.res.addListener('data', function(chunk) {
                body += chunk;
            });
            http.res.addListener('end', function(chunk) {
                log.put(JSON.stringify({
                    ts: new Date(), 
                    req: {
                        headersLines: http.req.headerLines,
                        body: http.req.body,
                    },
                    res: {
                        statusCode: http.res.statusCode, 
                        headers: http.res.headers, 
                        body: body
                    }
                }));
            });
        }
    };
    return loopWrapper(fun, null, finish);
}

monitorUniqueUrlsLoop = function(uniqs, fun) {
    var finish = function(http) { uniqs.put(http.req.path) };
    return loopWrapper(fun, null, finish);
}

loopWrapper = function(fun, start, finish) {
    return function(loopFun, args) {
        if (start != null) {
            start(args);
        }
        var finishFun = function(result) {
            if (result == null) {
                qputs('Function result is null; did you forget to call loopFun(result)?');
            } else {
                if (finish != null) {
                    finish(result);
                }
            }
            loopFun(result);
        }
        fun(finishFun, args);
    }
}

progressReportLoop = function(stats, progressFun) {
    return function(loopFun) {
        if (progressFun != null)
            progressFun(stats);
        defaultProgressReport(stats);
        loopFun();
    }
}



// ------------------------------------
// Progress Reporting
// ------------------------------------
var progressSummaryEnabled = false;

function defaultProgressReport(stats) {
    var out = '{"ts": ' + JSON.stringify(new Date());
    for (var i in stats) {
        var stat = stats[i];
        var summary = stat.interval.summary();
        out += ', "' + stat.name + '": '
        if (stat.interval.length > 0) {
            out += JSON.stringify(summary);
        }
        if (HTTP_REPORT.charts[stat.name] != null) {
            HTTP_REPORT.charts[stat.name].put(summary);
        }
        stats[i].next();
    }
    out += "}";
    STATS_LOG.put(out + ",");
    qprint('.');

    if (progressSummaryEnabled) {
        summaryReport(summaryStats);
    } else {
        writeReport();
    }
}

function summaryReport(statsList) {
    function pad(str, width) {
        return str + (new Array(width-str.length)).join(" ");
    }
    var out = pad("  Test Duration:", 20) + ((new Date() - start)/60000).toFixed(1) + " minutes\n";
    
    // statsList is a list of maps: [{'name': Reportable, ...}, ...]
    for (var s in statsList) {
        var stats = statsList[s];
        for (var i in stats) {
            var stat = stats[i];
            var summary = stat.cumulative.summary();
            out += "\n" +
                   "  " + stat.name + "\n" +
                   "  " + (new Array(stat.name.length+1)).join("-") + "\n";
            for (var j in summary) {
                out += pad("    " + j + ":", 20)  + summary[j] + "\n";
            }
        }
    }
    HTTP_REPORT.setText(out);
    writeReport();
}



// ------------------------------------
// HTTP Server
// ------------------------------------
var MAX_POINTS_PER_CHART = 60;

function Report(name) {
    this.name = name;
    this.clear();
}
Report.prototype = {
    setText: function(text) {
        this.text = text;
    },
    puts: function(text) {
        this.text += text + "\n";
    },
    addChart: function(name) {
        var chart = new Chart(name);
        if (this.charts[chart.name] != null)
            chart.name += "-1";
        this.charts[chart.name] = chart;
        return chart;
    },
    removeChart: function(name) {
        delete this.charts[name];
    },
    clear: function() {
        this.text = "";
        this.charts = {};
    }
}

function Chart(name) {
    this.name = name;
    this.uid = uid();
    this.data = {}
}
Chart.prototype = {
    put: function(data) {
        var time = new Date().getTime();
        for (item in data) {
            if (this.data[item] == null) {
                this.data[item] = [];
            }
            this.data[item].push([time, data[item]]);
        }
    }
}

function getFlotChart(data) {
    var chart = [];
    for (category in data) {
        var samples = sample(data[category], MAX_POINTS_PER_CHART);
        chart.push({ label: category, data: samples });
    }
    return JSON.stringify(chart);
}

function sample(data, points) {
    if (data.length <= points)
        return data;
    
    var samples = [];
    for (var i = 0; i < data.length; i += Math.ceil(data.length / points)) {
        samples.push(data[i]);
    }
    if (data.length % points != 0) {
        samples.push(data[data.length-1]);
    }
    return samples;
}

function getReportAsHtml(report) {
    var chartdivs = "";
    var plotcharts = "";
    for (var i in report.charts) {
        var c = report.charts[i];
        var uid = report.charts[i].uid;
        chartdivs += '<h2>' + c.name + '</h2>' +
                     '<div id="chart' + uid + '" style="width:800px;height:400px;"></div>';
        plotcharts += 'data' + uid + ' = ' + getFlotChart(c.data) + '; ' +
                     '$.plot($("#chart' + uid + '"), data' + uid + ', options); ' +
                     'setInterval(function() {' +
                     '    $.ajax({ url: "/data/' + querystring.escape(report.name) + '/' + querystring.escape(c.name) + '",' +
                     '          dataType: "json",' +
                     '          success: function(result) {' +
                     '              $.plot($("#chart' + uid + '"), result, options);' +
                     '          }' +
                     '    })},' +
                     '    ' + SUMMARY_HTML_REFRESH_PERIOD + ');'
    }
    var now = new Date();
    var html = '<html><head><title>nodeload results: ' + now + '</title>' +
           '<script language="javascript" type="text/javascript" src="./flot/jquery.js"></script>' +
           '<script language="javascript" type="text/javascript" src="./flot/jquery.flot.js"></script>' +
           '</head><body><h1>Test Results from ' + now + '</h1><pre id="reportText">' + report.text + '</pre>' +
           chartdivs +
           '<script id="source" language="javascript" type="text/javascript">' +
           '$(document).ready(function() {' +
           '    plot_data();' +
           '    setInterval(refresh_text, ' + SUMMARY_HTML_REFRESH_PERIOD + ');' +
           '});\n' +
           'function plot_data() {' +
           '    var options = {' +
           '      lines: {show: true},' +
           '      points: {show: true},' +
           '      legend: {position: "ne", backgroundOpacity: 0},' +
           '      xaxis: { mode: "time", timeformat: "%H:%M:%S"},' +
           '    };\n' +
                plotcharts + 
           '};\n' + 
           'function refresh_text() {' +
           '    $.ajax({ url: "/data/' + querystring.escape(report.name) + '/report-text",' +
           '          success: function(result) {' +
           '              if (result != null && result.length > 0) $("#reportText").text(result);' +
           '          }});' +
           '}' +
           '</script>' +
           '</body></html>'

     return html;
}

function serveReport(report, response) {
    var html = getReportAsHtml(report);
    response.sendHeader(200, {"Content-Type": "text/html", "Content-Length": html.length});
    response.write(html);
    response.close();
}

function serveChart(chart, response) {
    if (chart != null) {
        var data = getFlotChart(chart.data);
        response.sendHeader(200, {"Content-Type": "text/json", "Content-Length": data.length});
        response.write(data);
    } else {
        response.sendHeader(404, {"Content-Type": "text/html", "Content-Length": 0});
        response.write("");
    }
    response.close();
}

function serveFile(file, response) {
    fs.stat(file, function(err, stat) {
        if (err == null) {
            if (stat.isFile()) {
                response.sendHeader(200, {
                    'Content-Length': stat.size,
                });

                fs.open(file, process.O_RDONLY, 0666, function (err, fd) {
                    if (err == null) {
                        var pos = 0;
                        function streamChunk() {
                            fs.read(fd, 16*1024, pos, "binary", function(err, chunk, bytesRead) {
                                if (err == null) {
                                    if (!chunk) {
                                        fs.close(fd);
                                        response.close();
                                        return;
                                    }

                                    response.write(chunk, "binary");
                                    pos += bytesRead;

                                    streamChunk();
                                } else {
                                    response.sendHeader(500, {"Content-Type": "text/plain"});
                                    response.write("Error reading file " + file);
                                    response.close();
                                }
                            });
                        }
                        streamChunk();
                    } else {
                        response.sendHeader(500, {"Content-Type": "text/plain"});
                        response.write("Error opening file " + file);
                        response.close();
                    }
                });
            } else{
                response.sendHeader(404, {"Content-Type": "text/plain"});
                response.write("Not a file: " + file);
                response.close();
            } 
        } else {
            response.sendHeader(404, {"Content-Type": "text/plain"});
            response.write("Cannot find file: " + file);
            response.close();
        }
    });
}

startHttpServer = function(port) {
    if (typeof HTTP_SERVER != "undefined")
        return;
        
    qputs('Serving progress report on port ' + port + '.');
    HTTP_SERVER = http.createServer(function (req, res) {
        var now = new Date();
        if (req.url == "/") {
            serveReport(HTTP_REPORT, res);
        } else if (req.url.match("^/data/main/report-text")) {
            res.sendHeader(200, {"Content-Type": "text/plain", "Content-Length": HTTP_REPORT.text.length});
            res.write(HTTP_REPORT.text);
            res.close();
        } else if (req.url.match("^/data/main/")) {
            serveChart(HTTP_REPORT.charts[querystring.unescape(req.url.substring(11))], res);
        } else {
            serveFile("." + req.url, res);
        }
    });
    HTTP_SERVER.listen(port);
}

stopHttpServer = function() {
    if (typeof HTTP_SERVER == "undefined")
        return;

    HTTP_SERVER.close();
    qputs('Shutdown report server.');
}

addReportStat = function(stat) {
    summaryStats.push([stat])
}

enableReportSummaryOnProgress = function(enabled) {
    progressSummaryEnabled = enabled;
}

writeReport = function() {
    if (!DISABLE_LOGS) {
        fs.writeFile(SUMMARY_HTML, getReportAsHtml(HTTP_REPORT), "ascii");
    }
}



// ------------------------------------
// Statistics
// ------------------------------------
Histogram = function(numBuckets) {
    // default histogram size of 5000: when tracking latency at ms resolution, this
    // lets us store latencies up to 5 seconds in the main array
    if (numBuckets == null)
        numBuckets = 5000;
    this.size = numBuckets;
    this.clear();
}
Histogram.prototype =  {
    clear: function() {
        this.start = new Date();
        this.length = 0;
        this.sum = 0;
        this.min = -1;
        this.max = -1;
        this.items = new Array(this.size);      // The main histogram buckets
        this.extra = [];                        // Any items falling outside of the buckets
        this.sorted = true;                     // Is extra[] currently sorted?
    },
    put: function(item) {
        this.length++;
        this.sum += item;
        if (item < this.min || this.min == -1) this.min = item;
        if (item > this.max || this.max == -1) this.max = item;
        
        if (item < this.items.length) {
            if (this.items[item] != null) {
                this.items[item]++;
            } else {
                this.items[item] = 1;
            }
        } else {
            this.sorted = false;
            this.extra.push(item);
        }
    },
    get: function(item) {
        if (item < this.items.length) {
            return this.items[item];
        } else {
            var count = 0;
            for (var i in this.extra) {
                if (this.extra[i] == item) {
                    count++;
                }
            }
            return count;
        }
    },
    mean: function() {
        return this.sum / this.length;
    },
    percentile: function(percentile) {
        var target = Math.floor(this.length * (1 - percentile));
        
        if (this.extra.length > target) {
            var idx = this.extra.length - target;
            if (!this.sorted) {
                this.extra = this.extra.sort(function(a, b) { return a - b });
                this.sorted = true;
            }
            return this.extra[idx];
        } else {
            var sum = this.extra.length;
            for (var i = this.items.length - 1; i >= 0; i--) {
                if (this.items[i] != null) {
                    sum += this.items[i];
                    if (sum >= target) {
                        return i;
                    }
                }
            }
            return 0;
        }
    },
    stddev: function() {
        var mean = this.mean();
        var s = 0;
        
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i] != null) {
                s += this.items[i] * Math.pow(i - mean, 2);
            }
        }
        this.extra.forEach(function (val) {
            s += Math.pow(val - mean, 2);
        });
        return Math.sqrt(s / this.length);
    },
    summary: function() {
        return {
            min: this.min,
            avg: this.mean().toFixed(1),
            median: this.percentile(.5),
            "95%": this.percentile(.95),
            "99%": this.percentile(.99),
            max: this.max};
    }
}

Accumulator = function() {
    this.total = 0;
    this.length = 0;
}
Accumulator.prototype = {
    put: function(stat) {
        this.total += stat;
        this.length++;
    },
    get: function() {
        return this.total;
    },
    clear: function() {
        this.total = 0;
        this.length = 0;
    },
    summary: function() {
        return { total: this.total };
    }
}

ResultsCounter = function() {
    this.start = new Date();
    this.items = {};
    this.items.total = 0;
    this.length = 0;
}
ResultsCounter.prototype = {
    put: function(item) {
        if (this.items[item] != null) {
            this.items[item]++;
        } else {
            this.items[item] = 1;
        }
        this.length++;
        this.items.total = this.length;
    },
    get: function(item) {
        if (item.length > 0) {
            var total = 0;
            for (var i in item) {
                total += this.items[i];
            }
            return total;
        } else {
            return this.items[item];
        }
    },
    clear: function() {
        this.start = new Date();
        this.items = {};
        this.length = 0;
        this.items.total = 0;
    },
    summary: function() {
        this.items.rps = (this.length / ((new Date() - this.start) / 1000)).toFixed(1);
        return this.items;
    }
}

Uniques = function() {
    this.start = new Date();
    this.items = {};
    this.uniques = 0;
    this.length = 0;
}
Uniques.prototype = {
    put: function(item) {
        if (this.items[item] != null) {
            this.items[item]++;
        } else {
            this.items[item] = 1;
            this.uniques++
        }
        this.length++;
    },
    get: function() {
        return this.uniques;
    },
    clear: function() {
        this.items = {};
        this.unqiues = 0;
        this.length = 0;
    },
    summary: function() {
        return {total: this.length, uniqs: this.uniques};
    }
}

Peak = function() {
    this.peak = 0;
    this.length = 0;
}
Peak.prototype = {
    put: function(item) {
        if (this.peak < item) {
            this.peak = item;
        }
        this.length++;
    },
    get: function(item) {
        return this.peak;
    },
    clear: function() {
        this.peak = 0;
    },
    summary: function() {
        return { max: this.peak };
    }
}

Rate = function() {
    this.start = new Date();
    this.length = 0;
}
Rate.prototype = {
    put: function() {
        this.length++;
    },
    get: function() {
        return this.length /  ((new Date() - this.start) / 1000);
    },
    clear: function() {
        this.start = new Date();
        this.length = 0;
    },
    summary: function() {
        return { rps: this.get() };
    }
}

LogFile = function(filename) {
    this.length = 0;
    this.filename = filename;
    this.open();
}
LogFile.prototype = {
    put: function(item) {
        fs.write(this.fd, item + "\n", null, "ascii");
        this.length++;
    },
    get: function(item) {
        fs.statSync(this.filename, function (err, stats) {
            if (err == null) item = stats;
        });
        return item;
    },
    clear: function() {
        this.close();
        this.open();
    },
    open: function() {
        this.fd = fs.openSync(
            this.filename,
            process.O_WRONLY|process.O_CREAT|process.O_TRUNC,
            process.S_IRWXU|process.S_IRWXG|process.S_IROTH);
    },
    close: function() {
        fs.closeSync(this.fd);
        this.fd = null;
    },
    summary: function() {
        return { file: this.filename, written: this.length };
    }
}

NullLog = function() { this.length = 0; }
NullLog.prototype = {
    put: function(item) { /* nop */ },
    get: function(item) { return null; },
    clear: function() { /* nop */ }, 
    open: function() { /* nop */ },
    close: function() { /* nop */ },
    summary: function() { return { file: 'null', written: 0 } }
}

Reportable = function(backend, name, addToHttpReport) {
    if (name == null)
        name = "";

    this.name = name;
    this.length = 0;
    this.interval = new backend();
    this.cumulative = new backend();
    if (addToHttpReport) {
        HTTP_REPORT.addChart(this.name);
    }
}
Reportable.prototype = {
    put: function(stat) {
        if (!this.disableIntervalReporting) {
            this.interval.put(stat);
        }
        this.cumulative.put(stat);
        this.length++;
    },
    get: function() { 
        return null; 
    },
    clear: function() {
        this.interval.clear();
        this.cumulative.clear();
    }, 
    next: function() {
        if (this.interval.length > 0)
            this.interval.clear();
    },
    summary: function() {
        return { interval: this.interval.summary(), cumulative: this.cumulative.summary() };
    }
}



// ------------------------------------
// Logs
// ------------------------------------
var logsOpen;
openAllLogs = function() {
    if (logsOpen)
        return;

    if (DISABLE_LOGS) {
        STATS_LOG = new NullLog();
        ERROR_LOG = new NullLog();
    } else {
        qputs("Opening log files.");
        STATS_LOG = new LogFile('results-' + start + '-stats.log');
        ERROR_LOG = new LogFile('results-' + start + '-err.log');
        SUMMARY_HTML = 'results-' + start + '-summary.html';
        
        // stats log should be a proper JSON array: output initial "["
        STATS_LOG.put("[");
    }

    logsOpen = true;
}

closeAllLogs = function() {
    // stats log should be a proper JSON array: output final "]"
    STATS_LOG.put("]");

    STATS_LOG.close();
    ERROR_LOG.close();

    if (!DISABLE_LOGS) {
        qputs("Closed log files.");
    }
}

qputs = function(s) {
    if (!QUIET) {
        sys.puts(s);
    }
}

qprint = function(s) {
    if (!QUIET) {
        sys.print(s);
    }
}



// ------------------------------------
// Initialization
// ------------------------------------
if (typeof QUIET == "undefined")
    QUIET = false;

if (typeof TEST_CONFIG == "undefined") {
    setTestConfig('short');
} else {
    setTestConfig(TEST_CONFIG);
}

if (typeof SCHEDULER == "undefined")
    SCHEDULER = new Scheduler();

if (typeof HTTP_REPORT == "undefined")
    HTTP_REPORT = new Report("main");

if (typeof HTTP_SERVER_PORT == "undefined")
    HTTP_SERVER_PORT = 8000;
    
if (typeof DISABLE_HTTP_SERVER == "undefined" || DISABLE_HTTP_SERVER == false)
    startHttpServer(HTTP_SERVER_PORT);

if (typeof DISABLE_LOGS == "undefined")
    DISABLE_LOGS = false;

openAllLogs();
