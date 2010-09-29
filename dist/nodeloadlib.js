if (typeof _NODELOADLIB != "undefined") return;
_NODELOADLIB = 1

var sys = require('sys');
var http = require('http');
var fs = require('fs');
var events = require('events');
var querystring = require('querystring');

var START = new Date().getTime();
var lastUid = 0;
var uid = function() { return lastUid++ };

if (typeof QUIET == "undefined")
    QUIET = false;

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
// Main HTTP load testing interface
// ------------------------------------
//
// This file contains the primary API for using nodeload to construct load tests.
//

/** TEST_DEFAULTS defines all of the parameters that can be set in a test specifiction passed
    to addTest(spec). By default, a test will GET localhost:8080/ as fast as possible with 
    10 users for 2 minutes. */
var TEST_DEFAULTS = {
    name: 'Debug test',                     // A descriptive name for the test

    host: 'localhost',                      // host and port specify where to connect
    port: 8080,                             //
    requestGenerator: null,                 // Specify one of: requestGenerator, requestLoop, or (method, path, requestData)
    requestLoop: null,                      //   - A requestGenerator is a function that takes a http.Client param
    method: 'GET',                          //     and returns a http.ClientRequest.
    path: '/',                              //   - A requestLoop is a function that takes two params (loopFun, http.Client).
    requestData: null,                      //     It should call loopFun({req: http.ClientRequest, res: http.ClientResponse})
                                            //     after each operation to schedule the next iteration of requestLoop.
                                            //   - (method, path, requestData) specify a single URL to test

    numClients: 10,                         // Maximum number of concurrent executions of request loop
    numRequests: Infinity,                  // Maximum number of iterations of request loop
    timeLimit: 120,                         // Maximum duration of test in seconds
    targetRps: Infinity,                    // Number of times per second to execute request loop
    delay: 0,                               // Seconds before starting test

    successCodes: null,                     // List of success HTTP response codes. Failures are logged to the error log.
    stats: ['latency', 'result-codes'],     // Specify list of: latency, result-codes, uniques, concurrency. Note that "uniques"
                                            // only shows up in summary report and requests must be made with traceableRequest().
                                            // Not doing so will result in reporting only 2 uniques.
    latencyConf: {percentiles: [.95,.99]},  // Set latencyConf.percentiles to percentiles to report for the 'latency' stat
    reportInterval: 2,                      // Seconds between each progress report
    reportFun: null,                        // Function called each reportInterval that takes a param, stats, which is a map of
                                            // { 'latency': Reportable(Histogram), 'result-codes': Reportable(ResultsCounter},
                                            // 'uniques': Reportable(Uniques), 'concurrency': Reportable(Peak) }
}

/** RAMP_DEFAULTS defines all of the parameters that can be set in a ramp-up specifiction passed
    to addRamp(spec). By default, a ramp will add 100 requests/sec over 10 seconds, adding 1 user
    each second. */
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

/** addTest(spec) is the primary method to create a load test with nodeloadlib. See TEST_DEFAULTS for a list
    of the configuration values that can be provided in the test specification, spec. Remember to call
    startTests() to kick off the tests defined though addTest(spec)/addRamp(spec). */
addTest = function(spec) {
    function req(client) {
        if (spec.requestGenerator == null) {
            if ((spec.requestData != null) && (spec.method.search('^(PUT|POST)$') != -1)) {
                var body = spec.requestData;
            }
            return traceableRequest(client, spec.method, spec.path, { 'host': spec.host }, body);
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
        var l = new Reportable([Histogram, spec.latencyConf], spec.name + ': Latency', true);
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
    if (spec.stats.indexOf('bytes') >= 0) {
        var bytes = new Reportable(Accumulator, spec.name + ': Request Bytes', true);
        monitored = monitorByteSentLoop(bytes, monitored);
        stats['request-bytes'] = bytes;
        
        var bytes = new Reportable(Accumulator, spec.name + ': Response Bytes', true);
        monitored = monitorByteReceivedLoop(bytes, monitored);
        stats['response-bytes'] = bytes;
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

/** addRamp(spec) defines a step-wise ramp-up of the load in a given test defined by a pervious addTest(spec)
    call. See RAMP_DEFAULTS for a list of the parameters that can be specified in the ramp specification, spec. */
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

/** Start all tests were added via addTest(spec) and addRamp(spec). When all tests complete, callback will
    be called. If stayAliveAfterDone is true, then the nodeload HTTP server will remain running. Otherwise,
    the server will automatically terminate once the tests are finished. */
startTests = function(callback, stayAliveAfterDone) {
    HTTP_REPORT.setText("In progress...");
    SCHEDULER.startAll(testsComplete(callback, stayAliveAfterDone));
}

/** A convenience function equivalent to addTest() followed by startTests() */
runTest = function(spec, callback, stayAliveAfterDone) {
    var t = addTest(spec);
    startTests(callback, stayAliveAfterDone);
    return t;
}

/** Stop all tests and shutdown nodeload */
endTest = function() {
    qputs("\nFinishing...");
    closeAllLogs();
    stopHttpServer();
    setTimeout(process.exit, 500);
}

/** Use traceableRequest instead of built-in node.js `http.Client.request()` when tracking the "uniques" statistic. 
    It allows URLs to be properly tracked. */
traceableRequest = function(client, method, path, headers, body) {
    if (headers != null && headers['content-length'] == null) {
        if (body == null) {
            headers['content-length'] = 0;
        } else {
            headers['content-length'] = body.length;
        }
    }

    var request = client.request(method, path, headers);

    request.headers = headers;
    request.path = path;

    if (body != null) {
        request.write(body);
    }
    request.body = body;

    return request;
}

/** Use a predefined configuration type. 'short' and 'long' are supported. In a 'short' duration test,
    stats reported every 2 seconds. In a 'long' duration test, stats are reported every 10 seconds. */
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

// =================
// Private methods
// =================

/** Returns a callback function that should be called at the end of the load test. It generates the
    summary file and calls the user specified callback function. It sets a timer for terminating 
    the nodeload process if no new tests are started by the user specified callback. */
function testsComplete(callback, stayAliveAfterDone) {
    return function() {
        qprint('done.\n');
        summaryReport(summaryStats);
        if (SLAVE_CONFIG == null && !stayAliveAfterDone) {
            // End process if not a slave and no more tests are started within 3 seconds.
            endTestTimeoutId = setTimeout(endTest, 3000);
        }
        if (callback != null) {
            callback();
        }
    }
}

/** Copy the value from defaults into spec for all fields that are non-existent or null. */
function defaults(spec, defaults) {
    for (var i in defaults) {
        if (spec[i] == null) {
            spec[i] = defaults[i];
        }
    }
}

// Initialize test configuration parameters (logging interval, HTML refresh interval, etc) 
if (typeof TEST_CONFIG == "undefined") {
    setTestConfig('short');
} else {
    setTestConfig(TEST_CONFIG);
}

// -----------------------------------------
// Event-based looping
// -----------------------------------------
//
// Nodeload uses the node.js event loop to schedule iterations of a particular function. In order for this
// to work, the function must cooperate by accepting a loopFun as its first argument and call loopFun() when
// it completes each iteration. This is refered to as "event-based looping" in nodeload.
//
// This file defines the generic ConditionalLoop for looping on an arbitrary function, and a number of
// other event based loops for predefined tasks, such as track the latency of the loop body.
//

// Wraps an arbitrary function to be executed in a loop. Each iteration of the loop is scheduled in
// the node.js event loop using process.nextTick(), which allows other events in the loop to be handled
// as the loop executes.
//
// @param fun   any function that:
//              1. accepts two parameters: loopFun and args
//              2. calls loopFun when it finishes
//              Use funLoop() to wrap any arbitrary function to make it usable in a ConditionalLoop
// @param args  passed as-is as the second argument to fun
// @param conditions    a list of functions that are called at the beginning of every loop. If any 
//                      function returns false, the loop terminates.
// @param delay number of seconds before the first iteration of fun is executed
ConditionalLoop = function(fun, args, conditions, delay) {
    this.fun = fun;
    this.args = args;
    this.conditions = (conditions == null) ? [] : conditions;
    this.delay = delay;
    this.stopped = true;
    this.callback = null;
}
ConditionalLoop.prototype = {
    /** Calls each function in ConditionalLoop.conditions. Returns false if any function returns false */
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
    /** Checks conditions and schedules the next loop iteration */
    loop: function() {
        if (this.checkConditions()) {
            var loop = this;
            process.nextTick(function() { loop.fun(function() { loop.loop() }, loop.args) });
        } else {
            if (this.callback != null)
                this.callback();
        }
    },
    /** Start executing "ConditionalLoop.fun" with the arguments, "ConditionalLoop.args", until any
        condition in "ConditionalLoop.conditions" returns false. The loop begins after a delay of
        "ConditionalLoop.delay" seconds. When the loop completes, the user defined function, callback
        is called. */
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

/** Returns a condition to use with ConditionalLoop that returns false after a given number of seconds */
timeLimit = function(seconds) {
    var start = new Date();
    return function() { 
        return (seconds == Infinity) || ((new Date() - start) < (seconds * 1000));
    };
}

/** Returns a condition to use with ConditionalLoop that returns false after a given number of iterations */
maxExecutions = function(numberOfTimes) {
    var counter = 0;
    return function() { 
        return (numberOfTimes == Infinity) || (counter++ < numberOfTimes)
    };
}

/** A wrapper for any existing function so it can be used by ConditionalLoop. e.g.:
    
        myfun = function(x) { return x+1; }
        new ConditionalLoop(funLoop(myfun), args, [timeLimit(10)], 0) 
    
    */
funLoop = function(fun) {
    return function(loopFun, args) {
        var result = fun(args);
        loopFun(result);
    }
}

/** Wrapper for a function that causes it to be executed "rps" times per second when used by ConditionalLoop. */
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
    var wrapperFun = function(loopFun, args) {
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
        fun(function() { finishFun(loopFun) }, args);
    }
    return wrapperFun;
}

/** Wrapper for request generator function, "generator", to be used by ConditionalLoop. "generator" may accept
    a single parameter which is an http client provided by nodeload. It must return a http.ClientRequest
    (i.e. return value of http.Client.request()). In addition, http.ClientRequest may contain a .timeout
    field specifying the maximum number of milliseconds to wait for a response. The returned function 
    expects an http client as it's 2nd (args) parameter. It calls loopFun({req: http.ClientRequest, res: http.ClientResponse})
    after each iteration. */
requestGeneratorLoop = function(generator) {
    return function(loopFun, client) {
        var request = generator(client);
        if (request == null) {
            qputs('WARN: HTTP request is null; did you forget to call return request?');
            loopfun(null);
        } else {
            var timedOut = false;
            var timeoutId = null;
            if (request.timeout != null) {
                timeoutId = setTimeout(function() {
                    timedOut = true;
                    loopFun({req: request, res: {statusCode: 0}});
                }, request.timeout);
            }
            request.on('response', function(response) {
                if (!timedOut) {
                    if (timeoutId != null) {
                        clearTimeout(timeoutId);
                    }
                    loopFun({req: request, res: response});
                }
            });
            request.end();
        }
    }
}

// ------------------------------------
// Monitoring loops
// ------------------------------------
/** Time each call to fun and write the runtime information to latencies, which is generally a 
    stats.js#Histogram object. */
monitorLatenciesLoop = function(latencies, fun) {
    var start = function() { return new Date() }
    var finish = function(result, start) { latencies.put(new Date() - start) };
    return loopWrapper(fun, start, finish);
}

/** Each call to fun should return an object {res: http.ClientResponse}. This function tracks the http
    response codes and writes them to results, which is generally a stats.js#ResultsCounter object. */
monitorResultsLoop = function(results, fun) {
    var finish = function(http) { results.put(http.res.statusCode) };
    return loopWrapper(fun, null, finish);
}

/** Each call to fun should return an object {res: http.ClientResponse}. This function reads the http
    response body and writes its size to bytesReceived, which is generally a stats.js#Accumlator object. */
monitorByteReceivedLoop = function(bytesReceived, fun) {
    var finish = function(http) { 
        http.res.on('data', function(chunk) {
            bytesReceived.put(chunk.length);
        });
    };
    return loopWrapper(fun, null, finish);
}

/** Each call to fun should return an object {res: http.ClientResponse}. This function reads the http
    response body and writes its size to bytesSent, which is generally a stats.js#Accumlator object. */
monitorByteSentLoop = function(bytesSent, fun) {
    var finish = function(http) {
        if (http.req.headers['content-length']) {
            bytesSent.put(http.req.headers['content-length']);
        }
    };
    return loopWrapper(fun, null, finish);
}

/** Tracks the concurrency of calls to fun and writes it to concurrency, which is generally a
    stats.js#Peak object. */
monitorConcurrencyLoop = function(concurrency, fun) {
    var c = 0;
    var start = function() { c++; };
    var finish = function() { concurrency.put(c--) };
    return loopWrapper(fun, start, finish);
}

/** Tracks the rate of calls to fun and writes it to rate, which is generally a stats.js#Rate object. */
monitorRateLoop = function(rate, fun) {
    var finish = function() { rate.put() };
    return loopWrapper(fun, null, finish);
}

/** Each call to fun should return an object {res: http.ClientResponse}. This function reads the http
    response code and writes the full request and response to "log" if the response code is not in the 
    "successCodes" list. "log" is generally a stats.js#LogFile object. */
monitorHttpFailuresLoop = function(successCodes, fun, log) {
    if (log == null)
        log = ERROR_LOG;
    var finish = function(http) {
        var body = "";
        if (successCodes.indexOf(http.res.statusCode) < 0) {
            http.res.on('data', function(chunk) {
                body += chunk;
            });
            http.res.on('end', function(chunk) {
                log.put(JSON.stringify({
                    ts: new Date(), 
                    req: {
                        headers: http.req.headers,
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

/** Each call to fun should return an object {req: http.ClientRequest}. This function writes the request
    URL to uniqs which is generally a stats.js#Uniques object. */
monitorUniqueUrlsLoop = function(uniqs, fun) {
    var finish = function(http) { uniqs.put(http.req.path) };
    return loopWrapper(fun, null, finish);
}

/** Wrap a ConditionalLoop compatible loop function. For each iteration, calls startRes = start(args) 
    before calling fun(), and calls finish(result, startRes) when fun() returns. */
loopWrapper = function(fun, start, finish) {
    return function(loopFun, args) {
        var startRes;
        if (start != null) {
            startRes = start(args);
        }
        var finishFun = function(result) {
            if (result == null) {
                qputs('Function result is null; did you forget to call loopFun(result)?');
            } else {
                if (finish != null) {
                    finish(result, startRes);
                }
            }
            loopFun(result);
        }
        fun(finishFun, args);
    }
}

/** Returns a ConditionalLoop compatible loop function that calls progressFun(stats) and 
    report.js#defaultProgressReport(stats) during each iteration. If this is a slave nodeload instance
    (SLAVE_CONFIG is defined), the statistics are also reported to the master node. A progressReportLoop
    should be scheduled in SCHEDULER to periodically gather statistics during a load test. */
progressReportLoop = function(stats, progressFun) {
    return function(loopFun) {
        if (progressFun != null)
            progressFun(stats);
        if (SLAVE_CONFIG != null)
            SLAVE_CONFIG.reportProgress(stats);
        defaultProgressReport(stats);
        loopFun();
    }
}

// -----------------------------------------
// Scheduler for event-based loops
// -----------------------------------------
//
// 
//

/** JOB_DEFAULTS defines all of the parameters that can be set in a job specifiction passed to
    Scheduler.schedule(spec). */
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
/** A scheduler starts and monitors a group of Jobs. There should only be a single instance of Scheduler,
    SCHEDULER. See also the Job class below. */
Scheduler = function() {
    this.id=uid();
    this.jobs = [];
    this.running = false;
    this.callback = null;
}
Scheduler.prototype = {
    /** Primary function for defining and adding a Job. Start all scheduled jobs by calling startAll(). */
    schedule: function(spec) {
        defaults(spec, JOB_DEFAULTS);
        var s = new Job(this, spec);
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
    /** Start all scheduled Jobs. When the jobs complete, the user defined function, callback is called. */
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
    /** Force all jobs to finish. The user defined callback will still be called. */
    stopAll: function() {
        for (var i in this.jobs) {
            this.jobs[i].stop();
        }
    },
    /** Iterate all jobs and see if any are still running. If all jobs are complete, then call
        the user defined callback function. */
    checkFinished: function() {
        for (var i in this.jobs) {
            if (this.jobs[i].monitored && this.jobs[i].started && !this.jobs[i].done) {
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

/** At a high level, a Job encapsulates a single load test. A Job instances represents a function that is
    being executed at a certain rate and concurrency for a set duration. See JOB_DEFAULTS for a list
    of the configuration values that can be provided in the job specification, spec.
    
    Jobs can be monitored or unmonitored. All monitored jobs must finish before Scheduler considers 
    the entire job group to be complete. Scheduler automatically stops all unmonitored jobs in the
    same group when all monitored jobs complete.
    
    TODO: find a better implementation of concurrency that doesn't require interaction with Scheduler */
function Job(scheduler, spec) {
    this.id = uid();
    this.scheduler = scheduler;
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
}
Job.prototype = {
    /** Scheduler calls this method to start the job. The user defined function, callback, is called when the
        job completes. This function basically creates and starts a ConditionalLoop instance (which is an "event 
        based loop"). To handle concurrency, jobs are cloned and the clones are added to the parent scheduler. */
    start: function(callback) {
        clearTimeout(this.warningTimeoutId); // Cancel "didn't start job" warning
        clearTimeout(endTestTimeoutId); // Do not end the process if loop is started

        if (this.fun == null)
            qputs("WARN: scheduling a null loop");
        if (this.started)
            return;
            
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
            this.scheduler.addJob(clone);
            this.scheduler.startJob(clone);
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
        
        this.started = true;
    },
    stop: function() {
        if (this.loop != null) {
            this.loop.stop();
        }
    },
    clone: function() {
        var job = this;
        var other = new Job(this.scheduler, {
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

// Instantiate global SCHEDULER singleton instance
if (typeof SCHEDULER == "undefined")
    SCHEDULER = new Scheduler();// -----------------------------------------
// Distributed testing
// -----------------------------------------
//
// This file contains the API for distributing load tests across multiple load generating nodes. See
// NODELOADLIB.md for instructions on running a distributed test. 
//
// Distributed tests work as follows:
// 1. One node is designated as master, and the others are slaves
// 2. The master node POSTs a string containing valid javascript to http://slave/remote on each slave
// 3. Each slave executes the javascript by calling eval().
// 4. Each slave periodically POSTs statistics as a JSON string back to the master at http://master/remote/progress
// 5. The master aggregates these statistics and generates reports just like a regular, non-distributed nodeloadlib instance
//

var SLAVE_CONFIG = null;
var WORKER_POOL = null;
var SLAVE_PING_PERIOD = 3000;

/** Returns a test that can be scheduled with `remoteStart(spec)` (See TEST_DEFAULTS in api.ja for a list
    of the configuration values that can be provided in the test specification */
remoteTest = function(spec) {
    return "(function() {\n" +
            "  var remoteSpec = JSON.parse('" + JSON.stringify(spec) + "');\n" +
            "  remoteSpec.requestGenerator = " + spec.requestGenerator + ";\n" +
            "  remoteSpec.requestLoop = " + spec.requestLoop + ";\n" +
            "  remoteSpec.reportFun = " + spec.reportFun + ";\n" +
            "  addTest(remoteSpec);\n" +
            "})();\n";
}

/** Run the list of tests, created by remoteTest(spec), on the specified slaves. Slaves will periodically 
    report statistics to master. When all tests complete, callback will be called. If stayAliveAfterDone 
    is true, then the nodeload HTTP server will remain running. Otherwise, the server will automatically
    terminate once the tests are finished. */
remoteStart = function(master, slaves, tests, callback, stayAliveAfterDone) {
    var remoteFun = "";
    for (var i in tests) {
        remoteFun += tests[i];
    }
    remoteFun += "startTests();\n";
    remoteSubmit(master, slaves, remoteFun, callback, stayAliveAfterDone);
}

/** Same as remoteStart(...), except runs a .js nodeload script rather than tests created using 
    remoteTest(spec). The script should use `addTest()` and `startTests()` to create and start tests,
    as if it were to run on the local machine, not remoteTest().  */
remoteStartFile = function(master, slaves, filename, callback, stayAliveAfterDone) {
    fs.readFile(filename, function (err, data) {
        if (err != null) throw err;
        data = data.replace(/^#![^\n]+\n/, '// removed shebang directive from runnable script\n');
        remoteSubmit(master, slaves, data, callback, stayAliveAfterDone);
    });
}

// =================
// Private methods
// =================
/** Creates a RemoteWorkerPool with the given master and slave and runs the specified code, fun, on 
    every slave node in the pool. fun is a string containing valid Javascript. callback and 
    stayAliveAfterDone are the same as for remoteStart(). */
function remoteSubmit(master, slaves, fun, callback, stayAliveAfterDone) {
    WORKER_POOL = new RemoteWorkerPool(master, slaves);
    WORKER_POOL.fun = fun;
    WORKER_POOL.start(callback, stayAliveAfterDone);
}

/** Converts this nodeload instance into a slave node by defining the global variable SLAVE_CONFIG.
    A slave node differ from normal (master) node because it sends statistics to a master node. */
function registerSlave(id, master) {
    SLAVE_CONFIG = new RemoteSlave(id, master);
}

/** A RemoteSlave represents a slave nodeload instance. RemoteSlave.reportProgress() POSTs statistics
    as a JSON formatted string to http://master/remote/progress. */
function RemoteSlave(id, master) {
    var master = (master == null) ? ["", 0] : master.split(":");
    this.id = id;
    this.masterhost = master[0];
    this.master = http.createClient(master[1], master[0]);
}
RemoteSlave.prototype = {
    sendReport: function(url, object) {
        var s = JSON.stringify(object);
        var req = this.master.request('POST', url, {'host': this.masterhost, 'content-length': s.length});
        req.write(s);
        req.end();
    },
    reportProgress: function(stats) {
        this.sendReport('/remote/progress', {slaveId: this.id, stats: stats});
    },
}
/** Represents a pool of nodeload instances with one master and multiple slaves. master and each slave 
    is specified as a string "host:port". Each slave node executes the Javascript specified in the "fun"
    string, and upon completion, "callback" is executed. */
function RemoteWorkerPool(master, slaves) {
    this.master = master;
    this.slaves = {};
    this.fun = null;
    this.callback = null;
    this.pingId = null;
    this.progressId = null;
    this.stats = {};

    for (var i in slaves) {
        var slave = slaves[i].split(":");
        this.slaves[slaves[i]] = {
            id: slaves[i],
            state: "notstarted",
            host: slave[0], 
            client: http.createClient(slave[1], slave[0])
        };
    }
}
RemoteWorkerPool.prototype = {
    /** Run the Javascript in the string RemoteWorkerPool.fun on each of the slave node and register
        a periodic alive check for each slave. */
    start: function(callback, stayAliveAfterDone) {
        // Construct a Javascript string which converts a nodeloadlib instance to a slave, and wraps
        // executes the contents of "fun" by placing it in an anonymous function call:
        //      registerSlave(slave-id, master-host:port);
        //      (function() { 
        //          contents of "fun", which usually contains calls to addTest(), startTests(), etc
        //      })()
        var fun = "(function() {" + this.fun + "})();";
        for (var i in this.slaves) {
            var slave = this.slaves[i];
            var slaveFun = "registerSlave('" + i + "','" + this.master + "');\n" + fun;
            // POST the Javascript string to each slave which will eval() it.
            var r = slave.client.request('POST', '/remote', {'host': slave.host, 'content-length': slaveFun.length});
            r.write(slaveFun);
            r.end();
            slave.state = "running";
        }

        // Register a period ping to make sure slave is still alive
        var worker = this;
        this.pingId = setInterval(function() { worker.sendPings() }, SLAVE_PING_PERIOD);
        this.callback = testsComplete(callback, stayAliveAfterDone);
        summaryStats = [this.stats];
    },
    /** Called after each round of slave pings to see if all the slaves have finished. A slave is "finished"
        if it reports that it finished successfully, or if it fails to respond to a ping and flagged with
        an error state. When all slaves are finished, the overall test is considered complete and the user 
        defined callback function is called. */
    checkFinished: function() {
        for (var i in this.slaves) {
            if (this.slaves[i].state != "done" && this.slaves[i].state != "error") {
                return;
            }
        }
        qprint("\nRemote tests complete.");
        
        var callback = this.callback;
        clearInterval(this.pingId);
        this.callback = null;
        this.slaves = {};
        if (callback != null) {
            callback();
        }
    },
    /** Issue a GET request to each slave at "http://slave/remote/state". This function is called every
        SLAVE_PING_PERIOD seconds. If a slave fails to respond in that amount of time, it is flagged with
        an error state. A slave will report that it is "done" when its SCHEDULER is no longer running, i.e.
        all its tests ran to completion (or no tests were started, because "fun" didn't call to startTests()). */
    sendPings: function() {
        var worker = this;
        // Read the response from ping() (GET /remote/state)
        var pong = function(slave) { return function(response) {
            if (slave.state == "ping") {
                if (response.statusCode == 200) {
                    slave.state = "running";
                } else if (response.statusCode == 410) {
                    qprint("\n" + slave.id + " done.");
                    slave.state = "done";
                }
            }
        }}
        // Send GET to /remote/state
        var ping = function(slave) {
            slave.state = "ping";
            var r = slave.client.request('GET', '/remote/state', {'host': slave.host, 'content-length': 0});
            r.on('response', pong(slave));
            r.end();
        }

        // Verify every slave responded to the last round of pings. Send ping to slave that are still alive.
        for (var i in this.slaves) {
            if (this.slaves[i].state == "ping") {
                qprint("\nWARN: slave " + i + " unresponsive.");
                this.slaves[i].state = "error";
            } else if (this.slaves[i].state == "running") {
                ping(this.slaves[i]);
            }
        }
        this.checkFinished();
    },
    /** Every time the master receives a progress report is received from a slave, update the overall 
        statistics. Since all the slaves will be on the same reporting schedule, we can expect the master
        to receive progress reports from all slaves at approxmiate the same time. We allow a 500ms window
        between the first and last report to arrive before updating the master stats. */
    scheduleProgressReport: function() {
        if (this.progressId == null) {
            var worker = this;
            this.progressId = setTimeout(function() { 
                defaultProgressReport(worker.stats);
                worker.progressId = null;
            }, 500);
        }
    },
    /** Process data received POSTed by a slave to http://master/remote/progress */
    receiveProgress: function(report) {
        if (this.slaves[report.slaveId] == null)
            return;
        this.slaves[report.slaveId].state = "running";
        for (var i in report.stats) {
            var stat = report.stats[i].name;
            if (this.stats[stat] == null) {
                var backend = statsClassFromString(report.stats[i].interval.type);
                this.stats[stat] = new Reportable([backend, report.stats[i].interval.params], stat, report.stats[i].addToHttpReport);
            }
            this.stats[stat].merge(report.stats[i].interval);
        }
        this.scheduleProgressReport();
    },
}

/** Handler for all the requests to /remote. See http.js#startHttpServer(). */
function serveRemote(url, req, res) {
    var readBody = function(req, callback) {
        var body = '';
        req.on('data', function(chunk) { body += chunk });
        req.on('end', function() { callback(body) });
    }
    var sendStatus = function(status) {
        res.writeHead(status, {"Content-Length": 0});
        res.end();
    }
    if (req.method == "POST" && url == "/remote") {
        readBody(req, function(remoteFun) {
            qputs("Starting remote test:\n" + remoteFun);
            eval(remoteFun);
            sendStatus(200);
        });
    } else if (req.method == "GET" && req.url == "/remote/state") {
        if (SCHEDULER.running == true) {
            res.writeHead(200, {"Content-Length": 0});
        } else {
            res.writeHead(410, {"Content-Length": 0});
        }
        res.end();
    } else if (req.method == "POST" && url == "/remote/stop") {
        qprint("\nReceived remote stop...");
        SCHEDULER.stopAll();
        sendStatus(200);
    } else if (req.method == "POST" && url == "/remote/progress") {
        readBody(req, function(report) {
            WORKER_POOL.receiveProgress(JSON.parse(report));
            sendStatus(200);
        });
    } else {
        sendStatus(405);
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
    var out = pad("  Test Duration:", 20) + ((new Date() - START)/60000).toFixed(1) + " minutes\n";
    
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
    this.columns = ["time"];
    this.rows = [[0]];
}
Chart.prototype = {
    put: function(data) {
        var row = [Math.floor((new Date().getTime() - START) / 600) / 100]; // 100ths of a minute
        for (item in data) {
            var col = this.columns.indexOf(item);
            if (col < 0) {
                col = this.columns.length;
                this.columns.push(item);
                this.rows[0].push(0);
            }
            row[col] = data[item];
        }
        this.rows.push(row);
    }
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
//
// Contains various statistics classes and function. The classes implement the same consistent interface. 
// See NODELOADLIB.md for a complete description of the classes and functions.

Histogram = function(params) {
    // default histogram size of 3000: when tracking latency at ms resolution, this
    // lets us store latencies up to 3 seconds in the main array
    var numBuckets = 3000;
    var percentiles = [0.95, 0.99];

    if (params != null && params.numBuckets != null)
        numBuckets = params.buckets;
    if (params != null && params.percentiles != null)
        percentiles = params.percentiles;
    
    this.type = "Histogram";
    this.params = params;
    this.size = numBuckets;
    this.percentiles = percentiles;
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
        var s = {
            min: this.min,
            max: this.max,
            avg: Number(this.mean().toFixed(1)),
            median: this.percentile(.5)
        };
        for (var i in this.percentiles) {
            s[this.percentiles[i] * 100 + "%"] = this.percentile(this.percentiles[i]);
        }
        return s;
    },
    merge: function(other) {
        if (this.items.length != other.items.length) {
            throw "Incompatible histograms";
        }

        this.length += other.length;
        this.sum += other.sum;
        this.min = (other.min != -1 && (other.min < this.min || this.min == -1)) ? other.min : this.min;
        this.max = (other.max > this.max || this.max == -1) ? other.max : this.max;
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i] != null) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
            }
        }
        this.extra = this.extra.concat(other.extra);
        this.sorted = false;
    }
}

Accumulator = function() {
    this.type = "Accumulator";
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
    },
    merge: function(other) {
        this.total += other.total;
        this.length += other.length;
    }
}

ResultsCounter = function() {
    this.type = "ResultsCounter";
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
    },
    summary: function() {
        this.items.total = this.length;
        this.items.rps = Number((this.length / ((new Date() - this.start) / 1000)).toFixed(1));
        return this.items;
    },
    merge: function(other) {
        for (var i in other.items) {
            if (this.items[i] != null) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
            }
        }
        this.length += other.length;
    }
}

Uniques = function() {
    this.type = "Uniques";
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
    },
    merge: function(other) {
        for (var i in other.items) {
            if (this.items[i] != null) {
                this.items[i] += other.items[i];
            } else {
                this.items[i] = other.items[i];
                this.uniques++;
            }
        }
        this.length += other.length;
    }
}

Peak = function() {
    this.type = "Peak";
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
    },
    merge: function(other) {
        if (this.peak < other.peak) {
            this.peak = other.peak;
        }
        this.length += other.length;
    }
}

Rate = function() {
    type = "Rate";
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
    },
    merge: function(other) {
        this.length += other.length;
    }
}

LogFile = function(filename) {
    this.type = "LogFile";
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

NullLog = function() { 
    this.type = "NullLog";
    this.length = 0;
}
NullLog.prototype = {
    put: function(item) { /* nop */ },
    get: function(item) { return null; },
    clear: function() { /* nop */ }, 
    open: function() { /* nop */ },
    close: function() { /* nop */ },
    summary: function() { return { file: 'null', written: 0 } }
}

Reportable = function(backend, name, addToHttpReport) {
    var backendparams = null;
    if (name == null)
        name = "";
    if (typeof backend == 'object') {
        backendparams = backend[1];
        backend = backend[0];
    }
        
    this.type = "Reportable";
    this.name = name;
    this.length = 0;
    this.interval = new backend(backendparams);
    this.cumulative = new backend(backendparams);
    this.addToHttpReport = addToHttpReport;
    
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
    },
    merge: function(other) {
        // other should be an instance of backend, NOT Reportable.
        this.interval.merge(other);
        this.cumulative.merge(other);
    }
}

roundRobin = function(list) {
    r = list.slice();
    r.rridx = -1;
    r.get = function() {
        this.rridx = (this.rridx+1) % this.length;
        return this[this.rridx];
    }
    return r;
}

randomString = function(length) {
    var s = "";
    for (var i = 0; i < length; i++) {
        s += '\\' + (Math.floor(Math.random() * 95) + 32).toString(8); // ascii chars between 32 and 126
    }
    return eval("'" + s + "'");
}

nextGaussian = function(mean, stddev) {
    if (mean == null) mean = 0;
    if (stddev == null) stddev = 1;
    var s = 0, z0, z1;
    while (s == 0 || s >= 1) {
        z0 = 2 * Math.random() - 1;
        z1 = 2 * Math.random() - 1;
        s = z0*z0 + z1*z1;
    }
    return z0 * Math.sqrt(-2 * Math.log(s) / s) * stddev + mean;
}

nextPareto = function(min, max, shape) {
    if (shape == null) shape = 0.1;
    var l = 1, h = Math.pow(1+max-min, shape), rnd = Math.random();
    while (rnd == 0) rnd = Math.random();
    return Math.pow((rnd*(h-l)-h) / -(h*l), -1/shape)-1+min;
}

function statsClassFromString(name) {
    types = {
        "Histogram": Histogram, 
        "Accumulator": Accumulator, 
        "ResultsCounter": ResultsCounter,
        "Uniques": Uniques,
        "Peak": Peak,
        "Rate": Rate,
        "LogFile": LogFile,
        "NullLog": NullLog,
        "Reportable": Reportable
    };
    return types[name];
}

// ------------------------------------
// Logs
// ------------------------------------
//
// Each time nodeloadlib is used, three result files are created:
// 1. results-<timestamp>-stats.log: Contains a log of all the statistics in JSON format
// 2. results-<timestamp>-err.log: Contains all failed HTTP request/responses
// 3. results-<timestamp>-summary.html: A HTML summary page of the load test 
//
var logsOpen;
openAllLogs = function() {
    if (logsOpen)
        return;

    if (DISABLE_LOGS) {
        STATS_LOG = new NullLog();
        ERROR_LOG = new NullLog();
    } else {
        qputs("Opening log files.");
        STATS_LOG = new LogFile('results-' + START + '-stats.log');
        ERROR_LOG = new LogFile('results-' + START + '-err.log');
        SUMMARY_HTML = 'results-' + START + '-summary.html';
        
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

// Initialize & open all log files
if (typeof DISABLE_LOGS == "undefined")
    DISABLE_LOGS = false;

openAllLogs();
// ------------------------------------
// HTTP Server
// ------------------------------------
var MAX_POINTS_PER_CHART = 60;

function getReportAsHtml(report) {
    var chartdivs = "";
    var plotcharts = "";
    for (var i in report.charts) {
        var c = report.charts[i];
        var uid = report.charts[i].uid;
        var chartdiv = 
            '<div class="post"><h2>' + c.name + '</h2>' +
            '<div class="entry" style="width:100%;float:left">' +
            '<div id="chart${id}" style="float:left;width:900px;height:200px;"></div>' +
            '<div id="chart${id}legend" style="float:left;width:124px;height:200px;"></div>' +
            '</div></div>';
        var plotchart = 
            'graph${id} = new Dygraph(' +
                'document.getElementById("chart${id}"),' + 
                JSON.stringify(c.rows) + ',' + 
                '{labelsDiv: document.getElementById("chart${id}legend"),' +
                ' labelsSeparateLines: true,' +
                ' labels: ' + JSON.stringify(c.columns) + 
                '});' +
            'if(navigator.appName == "Microsoft Internet Explorer") { http${id} = new ActiveXObject("Microsoft.XMLHTTP"); } else { http${id} = new XMLHttpRequest(); }' +
            'setInterval(function() { ' +
                'http${id}.open("GET", "/data/' + querystring.escape(report.name) + '/' + querystring.escape(c.name) + '");' +
                'http${id}.onreadystatechange=function() { if(http${id}.readyState == 4) { graph${id}.updateOptions({"file": JSON.parse(http${id}.responseText)});}};' +
                'http${id}.send(null);' +
            '}, ' + SUMMARY_HTML_REFRESH_PERIOD + ');';
        chartdivs += chartdiv.replace(/\$\{id\}/g, uid);
        plotcharts += plotchart.replace(/\$\{id\}/g, uid);
    }
    var now = new Date();
    var html = 
            '<html><head><title>Test Results</title>' +
            '<script language="javascript" type="text/javascript" src="./dist/dygraph-combined.js"></script>' +
            '<style><!--' +
            'body { margin: 0px; font: 13px Arial, Helvetica, sans-serif; }' +
            'h1 { font-size: 2.4em; }' +
            'p, ol, ul { line-height: 30%; }' +
            'a:hover { text-decoration: none; }' +
            '#header { width: 100%; height: 100px; margin: 0px auto; color: #FFFFFF; background: #699C4D; border: 3px solid darkgreen; border-style: none none solid none;}' +
            '#header h1 { width: 1024; padding: 25px 0px 0px 0px; margin: 0px auto; font-weight: normal; }' +
            '#header p { width: 1024; padding: 15px 0px 0px 0px; margin: 0px auto; }' +
            '#page { width: 1024px; margin: 0px auto; padding: 30px 0px; }' +
            '.post { margin: 0px 0px 30px 0px; }' +
            '.post h1, .post h2 { margin: 0px; padding: 0px 0px 5px 0px; border-bottom: #BFC9AE solid 1px; color: #232F01; }' +
            '.entry { margin: 10px 0px 20px 0px; }' +
            '#footer { clear: both; width: 1024px; height: 50px; margin: 0px auto 30px auto; color: #FFFFFF; background: #699C4D; }' +
            '#footer p { padding: 19px 0px 0px 0px; text-align: center; line-height: normal; font-size: smaller; }' +
            '#footer a { color: #FFFFFF; }' +
            '--></style>' +
            '</head>' +
            '<body>' +
            '<div id="header"><h1>Test Results</h1><p>' + now + '</p></div>' +
            '<div id="page"><div id="content">' +
                '<div class="post"><h2>Summary</h2><div class="entry">' +
                    '<p><pre id="reportText">' + report.text + '</pre></p>' +
                '</div></div>' +
                chartdivs +
            '</div></div>' +
            '<script id="source" language="javascript" type="text/javascript">' +
            'if(navigator.appName == "Microsoft Internet Explorer") { http = new ActiveXObject("Microsoft.XMLHTTP"); } else { http = new XMLHttpRequest(); }' +
            'setInterval(function() {' +
                'http.open("GET", "/data/' + querystring.escape(report.name) + '/report-text");' +
                'http.onreadystatechange=function() { if(http.readyState == 4 && http.status == 200) { document.getElementById("reportText").innerText = http.responseText }};' +
                'http.send(null);' +
            '}, ' + SUMMARY_HTML_REFRESH_PERIOD + ');' +
            plotcharts+
            '</script>' +
            '<div id="footer"><p>generated with <a href="http://github.com/benschmaus/nodeload">nodeload</a></p></div>' +
            '</body></html>';

     return html;
}

function serveReport(report, response) {
    var html = getReportAsHtml(report);
    response.writeHead(200, {"Content-Type": "text/html", "Content-Length": html.length});
    response.write(html);
    response.end();
}

function serveChart(chart, response) {
    if (chart != null) {
        var data = JSON.stringify(chart.rows);
        response.writeHead(200, {"Content-Type": "text/csv", "Content-Length": data.length});
        response.write(data);
    } else {
        response.writeHead(404, {"Content-Type": "text/html", "Content-Length": 0});
        response.write("");
    }
    response.end();
}

function serveFile(file, response) {
    fs.stat(file, function(err, stat) {
        if (err == null) {
            if (stat.isFile()) {
                response.writeHead(200, {
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
                                        response.end();
                                        return;
                                    }

                                    response.write(chunk, "binary");
                                    pos += bytesRead;

                                    streamChunk();
                                } else {
                                    response.writeHead(500, {"Content-Type": "text/plain"});
                                    response.write("Error reading file " + file);
                                    response.end();
                                }
                            });
                        }
                        streamChunk();
                    } else {
                        response.writeHead(500, {"Content-Type": "text/plain"});
                        response.write("Error opening file " + file);
                        response.end();
                    }
                });
            } else{
                response.writeHead(404, {"Content-Type": "text/plain"});
                response.write("Not a file: " + file);
                response.end();
            } 
        } else {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("Cannot find file: " + file);
            response.end();
        }
    });
}

startHttpServer = function(port) {
    if (typeof HTTP_SERVER != "undefined")
        return;
        
    qputs('Serving progress report on port ' + port + '.');
    HTTP_SERVER = http.createServer(function (req, res) {
        var now = new Date();
        if (req.method == "GET" && req.url == "/") {
            serveReport(HTTP_REPORT, res);
        } else if (req.method == "GET" && req.url.match("^/data/main/report-text")) {
            res.writeHead(200, {"Content-Type": "text/plain", "Content-Length": HTTP_REPORT.text.length});
            res.write(HTTP_REPORT.text);
            res.end();
        } else if (req.method == "GET" && req.url.match("^/data/main/")) {
            serveChart(HTTP_REPORT.charts[querystring.unescape(req.url.substring(11))], res);
        } else if (req.method == "GET" && req.url.match("^/remote")) {
            serveRemote(req.url, req, res);
        } else if (req.url.match("^/remote")) {
            serveRemote(req.url, req, res);
        } else if (req.method == "GET") {
            serveFile("." + req.url, res);
        } else {
            res.writeHead(405, {"Content-Length": "0"});
            res.end();
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


// Define and start HTTP server
if (typeof HTTP_REPORT == "undefined")
    HTTP_REPORT = new Report("main");

if (typeof HTTP_SERVER_PORT == "undefined") {
    HTTP_SERVER_PORT = 8000;
    if (process.env['HTTP_SERVER_PORT'] != null) {
        HTTP_SERVER_PORT = Number(process.env['HTTP_SERVER_PORT']);
    }
}
    
if (typeof DISABLE_HTTP_SERVER == "undefined" || DISABLE_HTTP_SERVER == false)
    startHttpServer(HTTP_SERVER_PORT);
