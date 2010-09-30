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

    var jobs = SCHEDULER.schedule({
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
    
    summaryStats.push(stats);
    return {
        stats: stats,
        spec: spec,
        jobs: jobs,
        fun: monitored
    }

    return s;
}

/** addRamp(spec) defines a step-wise ramp-up of the load in a given test defined by a pervious addTest(spec)
    call. See RAMP_DEFAULTS for a list of the parameters that can be specified in the ramp specification, spec. */
addRamp = function(spec) {
    defaults(spec, RAMP_DEFAULTS);
    var rampStep = funLoop(function() {
        SCHEDULER.schedule({
            fun: spec.test.fun,
            argGenerator: function() { return http.createClient(spec.test.spec.port, spec.test.spec.host) },
            rps: spec.rpsPerStep,
            concurrency: spec.clientsPerStep,
            monitored: false
        });
    });
    var jobs = SCHEDULER.schedule({
        fun: rampStep,
        delay: spec.delay,
        duration: spec.timeLimit,
        rps: spec.numberOfSteps / spec.timeLimit,
        monitored: false
    });

    return {
        spec: spec,
        jobs: jobs,
        fun: rampStep
    }
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
    /** Primary function for defining and adding new Jobs. Start all scheduled jobs by calling startAll(). If
        the scheduler is already startd, the jobs are started immediately upon scheduling. */
    schedule: function(spec) {
        defaults(spec, JOB_DEFAULTS);

        // concurrency is handled by creating multiple jobs with portions of the load
        var scheduledJobs = []
        spec.numberOfTimes /= spec.concurrency;
        spec.rps /= spec.concurrency;
        for (var i = 0; i < spec.concurrency; i++) {
            var s = new Job(spec);
            this.addJob(s);
            scheduledJobs.push(s);

            // If the scheduler is already running (startAll() was already called), start new jobs immediately
            if (this.running) { this.startJob(s); }
        }
        
        return scheduledJobs;
    },
    addJob: function(job) {
        this.jobs.push(job);
    },
    startJob: function(job) {
        var scheduler = this;
        job.start(function() { scheduler.checkFinished() });
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
    being executed at a certain rate for a set number of times or duration. See JOB_DEFAULTS for a list
    of the configuration values that can be provided in the job specification, spec.
    
    Jobs can be monitored or unmonitored. All monitored jobs must finish before Scheduler considers 
    the entire job group to be complete. Scheduler automatically stops all unmonitored jobs in the
    same group when all monitored jobs complete. */
function Job(spec) {
    this.id = uid();
    this.fun = spec.fun;
    this.args = spec.args;
    this.argGenerator = spec.argGenerator;
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
        based loop"). */
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

        if (this.rps != null && this.rps < Infinity) {
            var rps = this.rps;
            fun = rpsLoop(rps, fun);
        }
        if (this.numberOfTimes != null && this.numberOfTimes < Infinity) {
            var numberOfTimes = this.numberOfTimes;
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
        var other = new Job({
            fun: job.fun,
            args: job.args,
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
//
// This file defines and starts the nodeload HTTP server. This following global variables may be defined
// before require()'ing this file to change the server's configuration:
//
// - DISABLE_HTTP_SERVER [false]: if true, do not start the HTTP server
// - HTTP_SERVER_PORT [8000]: the port the HTTP server listens on
// - SUMMARY_HTML_REFRESH_PERIOD [2]: number of seconds between auto-refresh of HTML summary page
// 
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
            '<html><head><title>Test Results</title> \
            <script language="javascript" type="text/javascript"><!--\n' +
            DYGRAPH_SOURCE +
            '\n--></script> \
            <style><!-- \
            body { margin: 0px; font: 13px Arial, Helvetica, sans-serif; } \
            h1 { font-size: 2.4em; } \
            p, ol, ul { line-height: 30%; } \
            a:hover { text-decoration: none; } \
            #header { width: 100%; height: 100px; margin: 0px auto; color: #FFFFFF; background: #699C4D; border: 3px solid darkgreen; border-style: none none solid none;} \
            #header h1 { width: 1024; padding: 25px 0px 0px 0px; margin: 0px auto; font-weight: normal; } \
            #header p { width: 1024; padding: 15px 0px 0px 0px; margin: 0px auto; } \
            #page { width: 1024px; margin: 0px auto; padding: 30px 0px; } \
            .post { margin: 0px 0px 30px 0px; } \
            .post h1, .post h2 { margin: 0px; padding: 0px 0px 5px 0px; border-bottom: #BFC9AE solid 1px; color: #232F01; } \
            .entry { margin: 10px 0px 20px 0px; } \
            #footer { clear: both; width: 1024px; height: 50px; margin: 0px auto 30px auto; color: #FFFFFF; background: #699C4D; } \
            #footer p { padding: 19px 0px 0px 0px; text-align: center; line-height: normal; font-size: smaller; } \
            #footer a { color: #FFFFFF; } \
            --></style> \
            </head> \
            <body> \n\
            <div id="header"><h1>Test Results</h1><p>' + now + '</p></div> \n\
            <div id="page"><div id="content"> \n\
               <div class="post"><h2>Summary</h2><div class="entry"> \n\
                   <p><pre id="reportText">' + report.text + '</pre></p> \n\
               </div></div>' +
               chartdivs +
            '</div></div> \n\
            <script id="source" language="javascript" type="text/javascript"> \n\
            if(navigator.appName == "Microsoft Internet Explorer") { http = new ActiveXObject("Microsoft.XMLHTTP"); } else { http = new XMLHttpRequest(); } \n\
            setInterval(function() { \n\
               http.open("GET", "/data/' + querystring.escape(report.name) + '/report-text"); \n\
               http.onreadystatechange=function() { if(http.readyState == 4 && http.status == 200) { document.getElementById("reportText").innerText = http.responseText }}; \n\
               http.send(null); \n\
            }, ' + SUMMARY_HTML_REFRESH_PERIOD + ');' +
            plotcharts +
            '</script> \n\
            <div id="footer"><p>generated with <a href="http://github.com/benschmaus/nodeload">nodeload</a></p></div> \n\
            </body></html>';

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
// This is the Dygraph library available at http://github.com/danvk/dygraphs
DYGRAPH_SOURCE='DygraphLayout=function(b,a){this.dygraph_=b;this.options={};Dygraph.update(this.options,a?a:{});this.datasets=new Array()};DygraphLayout.prototype.attr_=function(a){return this.dygraph_.attr_(a)};DygraphLayout.prototype.addDataset=function(a,b){this.datasets[a]=b};DygraphLayout.prototype.evaluate=function(){this._evaluateLimits();this._evaluateLineCharts();this._evaluateLineTicks()};DygraphLayout.prototype._evaluateLimits=function(){this.minxval=this.maxxval=null;if(this.options.dateWindow){this.minxval=this.options.dateWindow[0];this.maxxval=this.options.dateWindow[1]}else{for(var c in this.datasets){if(!this.datasets.hasOwnProperty(c)){continue}var d=this.datasets[c];var b=d[0][0];if(!this.minxval||b<this.minxval){this.minxval=b}var a=d[d.length-1][0];if(!this.maxxval||a>this.maxxval){this.maxxval=a}}}this.xrange=this.maxxval-this.minxval;this.xscale=(this.xrange!=0?1/this.xrange:1);this.minyval=this.options.yAxis[0];this.maxyval=this.options.yAxis[1];this.yrange=this.maxyval-this.minyval;this.yscale=(this.yrange!=0?1/this.yrange:1)};DygraphLayout.prototype._evaluateLineCharts=function(){this.points=new Array();for(var e in this.datasets){if(!this.datasets.hasOwnProperty(e)){continue}var d=this.datasets[e];for(var b=0;b<d.length;b++){var c=d[b];var a={x:((parseFloat(c[0])-this.minxval)*this.xscale),y:1-((parseFloat(c[1])-this.minyval)*this.yscale),xval:parseFloat(c[0]),yval:parseFloat(c[1]),name:e};if(a.y<=0){a.y=0}if(a.y>=1){a.y=1}this.points.push(a)}}};DygraphLayout.prototype._evaluateLineTicks=function(){this.xticks=new Array();for(var c=0;c<this.options.xTicks.length;c++){var b=this.options.xTicks[c];var a=b.label;var d=this.xscale*(b.v-this.minxval);if((d>=0)&&(d<=1)){this.xticks.push([d,a])}}this.yticks=new Array();for(var c=0;c<this.options.yTicks.length;c++){var b=this.options.yTicks[c];var a=b.label;var d=1-(this.yscale*(b.v-this.minyval));if((d>=0)&&(d<=1)){this.yticks.push([d,a])}}};DygraphLayout.prototype.evaluateWithError=function(){this.evaluate();if(!this.options.errorBars){return}var d=0;for(var g in this.datasets){if(!this.datasets.hasOwnProperty(g)){continue}var c=0;var f=this.datasets[g];for(var c=0;c<f.length;c++,d++){var e=f[c];var a=parseFloat(e[0]);var b=parseFloat(e[1]);if(a==this.points[d].xval&&b==this.points[d].yval){this.points[d].errorMinus=parseFloat(e[2]);this.points[d].errorPlus=parseFloat(e[3])}}}};DygraphLayout.prototype.removeAllDatasets=function(){delete this.datasets;this.datasets=new Array()};DygraphLayout.prototype.updateOptions=function(a){Dygraph.update(this.options,a?a:{})};DygraphCanvasRenderer=function(c,b,d,a){this.dygraph_=c;this.options={strokeWidth:0.5,drawXAxis:true,drawYAxis:true,axisLineColor:"black",axisLineWidth:0.5,axisTickSize:3,axisLabelColor:"black",axisLabelFont:"Arial",axisLabelFontSize:9,axisLabelWidth:50,drawYGrid:true,drawXGrid:true,gridLineColor:"rgb(128,128,128)",fillAlpha:0.15,underlayCallback:null};Dygraph.update(this.options,a);this.layout=d;this.element=b;this.container=this.element.parentNode;this.height=this.element.height;this.width=this.element.width;if(!this.isIE&&!(DygraphCanvasRenderer.isSupported(this.element))){throw"Canvas is not supported."}this.xlabels=new Array();this.ylabels=new Array();this.area={x:this.options.yAxisLabelWidth+2*this.options.axisTickSize,y:0};this.area.w=this.width-this.area.x-this.options.rightGap;this.area.h=this.height-this.options.axisLabelFontSize-2*this.options.axisTickSize;this.container.style.position="relative";this.container.style.width=this.width+"px"};DygraphCanvasRenderer.prototype.clear=function(){if(this.isIE){try{if(this.clearDelay){this.clearDelay.cancel();this.clearDelay=null}var b=this.element.getContext("2d")}catch(d){this.clearDelay=MochiKit.Async.wait(this.IEDelay);this.clearDelay.addCallback(bind(this.clear,this));return}}var b=this.element.getContext("2d");b.clearRect(0,0,this.width,this.height);for(var a=0;a<this.xlabels.length;a++){var c=this.xlabels[a];c.parentNode.removeChild(c)}for(var a=0;a<this.ylabels.length;a++){var c=this.ylabels[a];c.parentNode.removeChild(c)}this.xlabels=new Array();this.ylabels=new Array()};DygraphCanvasRenderer.isSupported=function(g){var b=null;try{if(typeof(g)=="undefined"||g==null){b=document.createElement("canvas")}else{b=g}var c=b.getContext("2d")}catch(d){var f=navigator.appVersion.match(/MSIE (\\d\\.\\d)/);var a=(navigator.userAgent.toLowerCase().indexOf("opera")!=-1);if((!f)||(f[1]<6)||(a)){return false}return true}return true};DygraphCanvasRenderer.prototype.render=function(){var b=this.element.getContext("2d");if(this.options.underlayCallback){this.options.underlayCallback(b,this.area,this.layout)}if(this.options.drawYGrid){var d=this.layout.yticks;b.save();b.strokeStyle=this.options.gridLineColor;b.lineWidth=this.options.axisLineWidth;for(var c=0;c<d.length;c++){var a=this.area.x;var e=this.area.y+d[c][0]*this.area.h;b.beginPath();b.moveTo(a,e);b.lineTo(a+this.area.w,e);b.closePath();b.stroke()}}if(this.options.drawXGrid){var d=this.layout.xticks;b.save();b.strokeStyle=this.options.gridLineColor;b.lineWidth=this.options.axisLineWidth;for(var c=0;c<d.length;c++){var a=this.area.x+d[c][0]*this.area.w;var e=this.area.y+this.area.h;b.beginPath();b.moveTo(a,e);b.lineTo(a,this.area.y);b.closePath();b.stroke()}}this._renderLineChart();this._renderAxis()};DygraphCanvasRenderer.prototype._renderAxis=function(){if(!this.options.drawXAxis&&!this.options.drawYAxis){return}var b=this.element.getContext("2d");var g={position:"absolute",fontSize:this.options.axisLabelFontSize+"px",zIndex:10,color:this.options.axisLabelColor,width:this.options.axisLabelWidth+"px",overflow:"hidden"};var d=function(i){var p=document.createElement("div");for(var o in g){if(g.hasOwnProperty(o)){p.style[o]=g[o]}}p.appendChild(document.createTextNode(i));return p};b.save();b.strokeStyle=this.options.axisLineColor;b.lineWidth=this.options.axisLineWidth;if(this.options.drawYAxis){if(this.layout.yticks&&this.layout.yticks.length>0){for(var e=0;e<this.layout.yticks.length;e++){var f=this.layout.yticks[e];if(typeof(f)=="function"){return}var l=this.area.x;var j=this.area.y+f[0]*this.area.h;b.beginPath();b.moveTo(l,j);b.lineTo(l-this.options.axisTickSize,j);b.closePath();b.stroke();var k=d(f[1]);var h=(j-this.options.axisLabelFontSize/2);if(h<0){h=0}if(h+this.options.axisLabelFontSize+3>this.height){k.style.bottom="0px"}else{k.style.top=h+"px"}k.style.left="0px";k.style.textAlign="right";k.style.width=this.options.yAxisLabelWidth+"px";this.container.appendChild(k);this.ylabels.push(k)}var m=this.ylabels[0];var n=this.options.axisLabelFontSize;var a=parseInt(m.style.top)+n;if(a>this.height-n){m.style.top=(parseInt(m.style.top)-n/2)+"px"}}b.beginPath();b.moveTo(this.area.x,this.area.y);b.lineTo(this.area.x,this.area.y+this.area.h);b.closePath();b.stroke()}if(this.options.drawXAxis){if(this.layout.xticks){for(var e=0;e<this.layout.xticks.length;e++){var f=this.layout.xticks[e];if(typeof(dataset)=="function"){return}var l=this.area.x+f[0]*this.area.w;var j=this.area.y+this.area.h;b.beginPath();b.moveTo(l,j);b.lineTo(l,j+this.options.axisTickSize);b.closePath();b.stroke();var k=d(f[1]);k.style.textAlign="center";k.style.bottom="0px";var c=(l-this.options.axisLabelWidth/2);if(c+this.options.axisLabelWidth>this.width){c=this.width-this.options.xAxisLabelWidth;k.style.textAlign="right"}if(c<0){c=0;k.style.textAlign="left"}k.style.left=c+"px";k.style.width=this.options.xAxisLabelWidth+"px";this.container.appendChild(k);this.xlabels.push(k)}}b.beginPath();b.moveTo(this.area.x,this.area.y+this.area.h);b.lineTo(this.area.x+this.area.w,this.area.y+this.area.h);b.closePath();b.stroke()}b.restore()};DygraphCanvasRenderer.prototype._renderLineChart=function(){var b=this.element.getContext("2d");var d=this.options.colorScheme.length;var n=this.options.colorScheme;var x=this.options.fillAlpha;var C=this.layout.options.errorBars;var q=this.layout.options.fillGraph;var E=[];for(var F in this.layout.datasets){if(this.layout.datasets.hasOwnProperty(F)){E.push(F)}}var y=E.length;this.colors={};for(var A=0;A<y;A++){this.colors[E[A]]=n[A%d]}for(var A=0;A<this.layout.points.length;A++){var t=this.layout.points[A];t.canvasx=this.area.w*t.x+this.area.x;t.canvasy=this.area.h*t.y+this.area.y}var o=function(i){return i&&!isNaN(i)};var s=b;if(C){if(q){this.dygraph_.warn("Can\'t use fillGraph option with error bars")}for(var A=0;A<y;A++){var g=E[A];var v=this.colors[g];s.save();s.strokeStyle=v;s.lineWidth=this.options.strokeWidth;var h=NaN;var f=[-1,-1];var k=0;var B=this.layout.yscale;var a=new RGBColor(v);var D="rgba("+a.r+","+a.g+","+a.b+","+x+")";s.fillStyle=D;s.beginPath();for(var w=0;w<this.layout.points.length;w++){var t=this.layout.points[w];k++;if(t.name==g){if(!o(t.y)){h=NaN;continue}var p=[t.y-t.errorPlus*B,t.y+t.errorMinus*B];p[0]=this.area.h*p[0]+this.area.y;p[1]=this.area.h*p[1]+this.area.y;if(!isNaN(h)){s.moveTo(h,f[0]);s.lineTo(t.canvasx,p[0]);s.lineTo(t.canvasx,p[1]);s.lineTo(h,f[1]);s.closePath()}f[0]=p[0];f[1]=p[1];h=t.canvasx}}s.fill()}}else{if(q){for(var A=0;A<y;A++){var g=E[A];var r;if(A>0){r=E[A-1]}var v=this.colors[g];s.save();s.strokeStyle=v;s.lineWidth=this.options.strokeWidth;var h=NaN;var f=[-1,-1];var k=0;var B=this.layout.yscale;var a=new RGBColor(v);var D="rgba("+a.r+","+a.g+","+a.b+","+x+")";s.fillStyle=D;s.beginPath();for(var w=0;w<this.layout.points.length;w++){var t=this.layout.points[w];k++;if(t.name==g){if(!o(t.y)){h=NaN;continue}var e=1+this.layout.minyval*this.layout.yscale;if(e<0){e=0}else{if(e>1){e=1}}var p=[t.y,e];p[0]=this.area.h*p[0]+this.area.y;p[1]=this.area.h*p[1]+this.area.y;if(!isNaN(h)){s.moveTo(h,f[0]);s.lineTo(t.canvasx,p[0]);s.lineTo(t.canvasx,p[1]);s.lineTo(h,f[1]);s.closePath()}f[0]=p[0];f[1]=p[1];h=t.canvasx}}s.fill()}}}for(var A=0;A<y;A++){var g=E[A];var v=this.colors[g];b.save();var t=this.layout.points[0];var l=this.dygraph_.attr_("pointSize");var h=null,c=null;var u=this.dygraph_.attr_("drawPoints");var z=this.layout.points;for(var w=0;w<z.length;w++){var t=z[w];if(t.name==g){if(!o(t.canvasy)){h=c=null}else{var m=(!h&&(w==z.length-1||!o(z[w+1].canvasy)));if(!h){h=t.canvasx;c=t.canvasy}else{s.beginPath();s.strokeStyle=v;s.lineWidth=this.options.strokeWidth;s.moveTo(h,c);h=t.canvasx;c=t.canvasy;s.lineTo(h,c);s.stroke()}if(u||m){s.beginPath();s.fillStyle=v;s.arc(t.canvasx,t.canvasy,l,0,2*Math.PI,false);s.fill()}}}}}b.restore()};Dygraph=function(c,b,a){if(arguments.length>0){if(arguments.length==4){this.warn("Using deprecated four-argument dygraph constructor");this.__old_init__(c,b,arguments[2],arguments[3])}else{this.__init__(c,b,a)}}};Dygraph.NAME="Dygraph";Dygraph.VERSION="1.2";Dygraph.__repr__=function(){return"["+this.NAME+" "+this.VERSION+"]"};Dygraph.toString=function(){return this.__repr__()};Dygraph.DEFAULT_ROLL_PERIOD=1;Dygraph.DEFAULT_WIDTH=480;Dygraph.DEFAULT_HEIGHT=320;Dygraph.AXIS_LINE_WIDTH=0.3;Dygraph.DEFAULT_ATTRS={highlightCircleSize:3,pixelsPerXLabel:60,pixelsPerYLabel:30,labelsDivWidth:250,labelsDivStyles:{},labelsSeparateLines:false,labelsKMB:false,labelsKMG2:false,showLabelsOnHighlight:true,yValueFormatter:function(a){return Dygraph.round_(a,2)},strokeWidth:1,axisTickSize:3,axisLabelFontSize:14,xAxisLabelWidth:50,yAxisLabelWidth:50,rightGap:5,showRoller:false,xValueFormatter:Dygraph.dateString_,xValueParser:Dygraph.dateParser,xTicker:Dygraph.dateTicker,delimiter:",",logScale:false,sigma:2,errorBars:false,fractions:false,wilsonInterval:true,customBars:false,fillGraph:false,fillAlpha:0.15,connectSeparatedPoints:false,stackedGraph:false,hideOverlayOnMouseOut:true};Dygraph.DEBUG=1;Dygraph.INFO=2;Dygraph.WARNING=3;Dygraph.ERROR=3;Dygraph.prototype.__old_init__=function(f,d,e,b){if(e!=null){var a=["Date"];for(var c=0;c<e.length;c++){a.push(e[c])}Dygraph.update(b,{labels:a})}this.__init__(f,d,b)};Dygraph.prototype.__init__=function(c,b,a){if(a==null){a={}}this.maindiv_=c;this.file_=b;this.rollPeriod_=a.rollPeriod||Dygraph.DEFAULT_ROLL_PERIOD;this.previousVerticalX_=-1;this.fractions_=a.fractions||false;this.dateWindow_=a.dateWindow||null;this.valueRange_=a.valueRange||null;this.wilsonInterval_=a.wilsonInterval||true;this.is_initial_draw_=true;c.innerHTML="";if(c.style.width==""){c.style.width=a.width||Dygraph.DEFAULT_WIDTH+"px"}if(c.style.height==""){c.style.height=a.height||Dygraph.DEFAULT_HEIGHT+"px"}this.width_=parseInt(c.style.width,10);this.height_=parseInt(c.style.height,10);if(c.style.width.indexOf("%")==c.style.width.length-1){this.width_=(this.width_*self.innerWidth/100)-10}if(c.style.height.indexOf("%")==c.style.height.length-1){this.height_=(this.height_*self.innerHeight/100)-10}if(a.stackedGraph){a.fillGraph=true}this.user_attrs_={};Dygraph.update(this.user_attrs_,a);this.attrs_={};Dygraph.update(this.attrs_,Dygraph.DEFAULT_ATTRS);this.boundaryIds_=[];this.labelsFromCSV_=(this.attr_("labels")==null);this.createInterface_();this.start_()};Dygraph.prototype.attr_=function(a){if(typeof(this.user_attrs_[a])!="undefined"){return this.user_attrs_[a]}else{if(typeof(this.attrs_[a])!="undefined"){return this.attrs_[a]}else{return null}}};Dygraph.prototype.log=function(a,b){if(typeof(console)!="undefined"){switch(a){case Dygraph.DEBUG:console.debug("dygraphs: "+b);break;case Dygraph.INFO:console.info("dygraphs: "+b);break;case Dygraph.WARNING:console.warn("dygraphs: "+b);break;case Dygraph.ERROR:console.error("dygraphs: "+b);break}}};Dygraph.prototype.info=function(a){this.log(Dygraph.INFO,a)};Dygraph.prototype.warn=function(a){this.log(Dygraph.WARNING,a)};Dygraph.prototype.error=function(a){this.log(Dygraph.ERROR,a)};Dygraph.prototype.rollPeriod=function(){return this.rollPeriod_};Dygraph.prototype.xAxisRange=function(){if(this.dateWindow_){return this.dateWindow_}var b=this.rawData_[0][0];var a=this.rawData_[this.rawData_.length-1][0];return[b,a]};Dygraph.prototype.yAxisRange=function(){return this.displayedYRange_};Dygraph.prototype.toDomCoords=function(b,f){var c=[null,null];var d=this.plotter_.area;if(b!==null){var a=this.xAxisRange();c[0]=d.x+(b-a[0])/(a[1]-a[0])*d.w}if(f!==null){var e=this.yAxisRange();c[1]=d.y+(e[1]-f)/(e[1]-e[0])*d.h}return c};Dygraph.prototype.toDataCoords=function(b,f){var c=[null,null];var d=this.plotter_.area;if(b!==null){var a=this.xAxisRange();c[0]=a[0]+(b-d.x)/d.w*(a[1]-a[0])}if(f!==null){var e=this.yAxisRange();c[1]=e[0]+(d.h-f)/d.h*(e[1]-e[0])}return c};Dygraph.addEvent=function(c,a,b){var d=function(f){if(!f){var f=window.event}b(f)};if(window.addEventListener){c.addEventListener(a,d,false)}else{c.attachEvent("on"+a,d)}};Dygraph.clipCanvas_=function(b,c){var a=b.getContext("2d");a.beginPath();a.rect(c.left,c.top,c.width,c.height);a.clip()};Dygraph.prototype.createInterface_=function(){var a=this.maindiv_;this.graphDiv=document.createElement("div");this.graphDiv.style.width=this.width_+"px";this.graphDiv.style.height=this.height_+"px";a.appendChild(this.graphDiv);var c={top:0,left:this.attr_("yAxisLabelWidth")+2*this.attr_("axisTickSize")};c.width=this.width_-c.left-this.attr_("rightGap");c.height=this.height_-this.attr_("axisLabelFontSize")-2*this.attr_("axisTickSize");this.clippingArea_=c;this.canvas_=Dygraph.createCanvas();this.canvas_.style.position="absolute";this.canvas_.width=this.width_;this.canvas_.height=this.height_;this.canvas_.style.width=this.width_+"px";this.canvas_.style.height=this.height_+"px";this.graphDiv.appendChild(this.canvas_);this.hidden_=this.createPlotKitCanvas_(this.canvas_);Dygraph.clipCanvas_(this.hidden_,this.clippingArea_);Dygraph.clipCanvas_(this.canvas_,this.clippingArea_);var b=this;Dygraph.addEvent(this.hidden_,"mousemove",function(d){b.mouseMove_(d)});Dygraph.addEvent(this.hidden_,"mouseout",function(d){b.mouseOut_(d)});this.layoutOptions_={xOriginIsZero:false};Dygraph.update(this.layoutOptions_,this.attrs_);Dygraph.update(this.layoutOptions_,this.user_attrs_);Dygraph.update(this.layoutOptions_,{errorBars:(this.attr_("errorBars")||this.attr_("customBars"))});this.layout_=new DygraphLayout(this,this.layoutOptions_);this.renderOptions_={colorScheme:this.colors_,strokeColor:null,axisLineWidth:Dygraph.AXIS_LINE_WIDTH};Dygraph.update(this.renderOptions_,this.attrs_);Dygraph.update(this.renderOptions_,this.user_attrs_);this.plotter_=new DygraphCanvasRenderer(this,this.hidden_,this.layout_,this.renderOptions_);this.createStatusMessage_();this.createRollInterface_();this.createDragInterface_()};Dygraph.prototype.destroy=function(){var a=function(c){while(c.hasChildNodes()){a(c.firstChild);c.removeChild(c.firstChild)}};a(this.maindiv_);var b=function(c){for(var d in c){if(typeof(c[d])==="object"){c[d]=null}}};b(this.layout_);b(this.plotter_);b(this)};Dygraph.prototype.createPlotKitCanvas_=function(a){var b=Dygraph.createCanvas();b.style.position="absolute";b.style.top=a.style.top;b.style.left=a.style.left;b.width=this.width_;b.height=this.height_;b.style.width=this.width_+"px";b.style.height=this.height_+"px";this.graphDiv.appendChild(b);return b};Dygraph.hsvToRGB=function(h,g,k){var c;var d;var l;if(g===0){c=k;d=k;l=k}else{var e=Math.floor(h*6);var j=(h*6)-e;var b=k*(1-g);var a=k*(1-(g*j));var m=k*(1-(g*(1-j)));switch(e){case 1:c=a;d=k;l=b;break;case 2:c=b;d=k;l=m;break;case 3:c=b;d=a;l=k;break;case 4:c=m;d=b;l=k;break;case 5:c=k;d=b;l=a;break;case 6:case 0:c=k;d=m;l=b;break}}c=Math.floor(255*c+0.5);d=Math.floor(255*d+0.5);l=Math.floor(255*l+0.5);return"rgb("+c+","+d+","+l+")"};Dygraph.prototype.setColors_=function(){var e=this.attr_("labels").length-1;this.colors_=[];var a=this.attr_("colors");if(!a){var c=this.attr_("colorSaturation")||1;var b=this.attr_("colorValue")||0.5;var j=Math.ceil(e/2);for(var d=1;d<=e;d++){if(!this.visibility()[d-1]){continue}var g=d%2?Math.ceil(d/2):(j+d/2);var f=(1*g/(1+e));this.colors_.push(Dygraph.hsvToRGB(f,c,b))}}else{for(var d=0;d<e;d++){if(!this.visibility()[d]){continue}var h=a[d%a.length];this.colors_.push(h)}}this.renderOptions_.colorScheme=this.colors_;Dygraph.update(this.plotter_.options,this.renderOptions_);Dygraph.update(this.layoutOptions_,this.user_attrs_);Dygraph.update(this.layoutOptions_,this.attrs_)};Dygraph.prototype.getColors=function(){return this.colors_};Dygraph.findPosX=function(a){var b=0;if(a.offsetParent){while(1){b+=a.offsetLeft;if(!a.offsetParent){break}a=a.offsetParent}}else{if(a.x){b+=a.x}}return b};Dygraph.findPosY=function(b){var a=0;if(b.offsetParent){while(1){a+=b.offsetTop;if(!b.offsetParent){break}b=b.offsetParent}}else{if(b.y){a+=b.y}}return a};Dygraph.prototype.createStatusMessage_=function(){if(!this.attr_("labelsDiv")){var a=this.attr_("labelsDivWidth");var c={position:"absolute",fontSize:"14px",zIndex:10,width:a+"px",top:"0px",left:(this.width_-a-2)+"px",background:"white",textAlign:"left",overflow:"hidden"};Dygraph.update(c,this.attr_("labelsDivStyles"));var d=document.createElement("div");for(var b in c){if(c.hasOwnProperty(b)){d.style[b]=c[b]}}this.graphDiv.appendChild(d);this.attrs_.labelsDiv=d}};Dygraph.prototype.createRollInterface_=function(){var f=this.attr_("showRoller")?"block":"none";var b={position:"absolute",zIndex:10,top:(this.plotter_.area.h-25)+"px",left:(this.plotter_.area.x+1)+"px",display:f};var e=document.createElement("input");e.type="text";e.size="2";e.value=this.rollPeriod_;for(var a in b){if(b.hasOwnProperty(a)){e.style[a]=b[a]}}var d=this.graphDiv;d.appendChild(e);var c=this;e.onchange=function(){c.adjustRoll(e.value)};return e};Dygraph.pageX=function(c){if(c.pageX){return(!c.pageX||c.pageX<0)?0:c.pageX}else{var d=document;var a=document.body;return c.clientX+(d.scrollLeft||a.scrollLeft)-(d.clientLeft||0)}};Dygraph.pageY=function(c){if(c.pageY){return(!c.pageY||c.pageY<0)?0:c.pageY}else{var d=document;var a=document.body;return c.clientY+(d.scrollTop||a.scrollTop)-(d.clientTop||0)}};Dygraph.prototype.createDragInterface_=function(){var n=this;var c=false;var e=false;var b=null;var a=null;var m=null;var k=null;var f=null;var l=null;var j=null;var g=0;var d=0;var i=function(o){return Dygraph.pageX(o)-g};var h=function(o){return Dygraph.pageX(o)-d};Dygraph.addEvent(this.hidden_,"mousemove",function(o){if(c){m=i(o);k=h(o);n.drawZoomRect_(b,m,f);f=m}else{if(e){m=i(o);k=h(o);n.dateWindow_[0]=l-(m/n.width_)*j;n.dateWindow_[1]=n.dateWindow_[0]+j;n.drawGraph_(n.rawData_)}}});Dygraph.addEvent(this.hidden_,"mousedown",function(o){g=Dygraph.findPosX(n.canvas_);d=Dygraph.findPosY(n.canvas_);b=i(o);a=h(o);if(o.altKey||o.shiftKey){if(!n.dateWindow_){return}e=true;j=n.dateWindow_[1]-n.dateWindow_[0];l=(b/n.width_)*j+n.dateWindow_[0]}else{c=true}});Dygraph.addEvent(document,"mouseup",function(o){if(c||e){c=false;b=null;a=null}if(e){e=false;l=null;j=null}});Dygraph.addEvent(this.hidden_,"mouseout",function(o){if(c){m=null;k=null}});Dygraph.addEvent(this.hidden_,"mouseup",function(o){if(c){c=false;m=i(o);k=h(o);var q=Math.abs(m-b);var p=Math.abs(k-a);if(q<2&&p<2&&n.attr_("clickCallback")!=null&&n.lastx_!=undefined){n.attr_("clickCallback")(o,n.lastx_,n.selPoints_)}if(q>=10){n.doZoom_(Math.min(b,m),Math.max(b,m))}else{n.canvas_.getContext("2d").clearRect(0,0,n.canvas_.width,n.canvas_.height)}b=null;a=null}if(e){e=false;l=null;j=null}});Dygraph.addEvent(this.hidden_,"dblclick",function(o){if(n.dateWindow_==null){return}n.dateWindow_=null;n.drawGraph_(n.rawData_);var p=n.rawData_[0][0];var q=n.rawData_[n.rawData_.length-1][0];if(n.attr_("zoomCallback")){n.attr_("zoomCallback")(p,q)}})};Dygraph.prototype.drawZoomRect_=function(c,d,b){var a=this.canvas_.getContext("2d");if(b){a.clearRect(Math.min(c,b),0,Math.abs(c-b),this.height_)}if(d&&c){a.fillStyle="rgba(128,128,128,0.33)";a.fillRect(Math.min(c,d),0,Math.abs(d-c),this.height_)}};Dygraph.prototype.doZoom_=function(d,a){var b=this.toDataCoords(d,null);var c=b[0];b=this.toDataCoords(a,null);var e=b[0];this.dateWindow_=[c,e];this.drawGraph_(this.rawData_);if(this.attr_("zoomCallback")){this.attr_("zoomCallback")(c,e)}};Dygraph.prototype.mouseMove_=function(b){var a=Dygraph.pageX(b)-Dygraph.findPosX(this.hidden_);var s=this.layout_.points;var m=-1;var j=-1;var q=1e+100;var r=-1;for(var f=0;f<s.length;f++){var h=Math.abs(s[f].canvasx-a);if(h>q){continue}q=h;r=f}if(r>=0){m=s[r].xval}if(a>s[s.length-1].canvasx){m=s[s.length-1].xval}this.selPoints_=[];var g=0;var d=s.length;var o=this.attr_("stackedGraph");if(!this.attr_("stackedGraph")){for(var f=0;f<d;f++){if(s[f].xval==m){this.selPoints_.push(s[f])}}}else{for(var f=d-1;f>=0;f--){if(s[f].xval==m){var c={};for(var e in s[f]){c[e]=s[f][e]}c.yval-=g;g+=c.yval;this.selPoints_.push(c)}}}if(this.attr_("highlightCallback")){var n=this.lastHighlightCallbackX;if(n!==null&&m!=n){this.lastHighlightCallbackX=m;this.attr_("highlightCallback")(b,m,this.selPoints_)}}this.lastx_=m;this.updateSelection_()};Dygraph.prototype.updateSelection_=function(){var a=this.attr_("highlightCircleSize");var n=this.canvas_.getContext("2d");if(this.previousVerticalX_>=0){var l=this.previousVerticalX_;n.clearRect(l-a-1,0,2*a+2,this.height_)}var m=function(c){return c&&!isNaN(c)};if(this.selPoints_.length>0){var b=this.selPoints_[0].canvasx;var d=this.attr_("xValueFormatter")(this.lastx_,this)+":";var e=this.attr_("yValueFormatter");var j=this.colors_.length;if(this.attr_("showLabelsOnHighlight")){for(var f=0;f<this.selPoints_.length;f++){if(!m(this.selPoints_[f].canvasy)){continue}if(this.attr_("labelsSeparateLines")){d+="<br/>"}var k=this.selPoints_[f];var h=new RGBColor(this.colors_[f%j]);var g=e(k.yval);d+=" <b><font color=\'"+h.toHex()+"\'>"+k.name+"</font></b>:"+g}this.attr_("labelsDiv").innerHTML=d}n.save();for(var f=0;f<this.selPoints_.length;f++){if(!m(this.selPoints_[f].canvasy)){continue}n.beginPath();n.fillStyle=this.plotter_.colors[this.selPoints_[f].name];n.arc(b,this.selPoints_[f].canvasy,a,0,2*Math.PI,false);n.fill()}n.restore();this.previousVerticalX_=b}};Dygraph.prototype.setSelection=function(b){this.selPoints_=[];var c=0;if(b!==false){b=b-this.boundaryIds_[0][0]}if(b!==false&&b>=0){for(var a in this.layout_.datasets){if(b<this.layout_.datasets[a].length){this.selPoints_.push(this.layout_.points[c+b])}c+=this.layout_.datasets[a].length}}if(this.selPoints_.length){this.lastx_=this.selPoints_[0].xval;this.updateSelection_()}else{this.lastx_=-1;this.clearSelection()}};Dygraph.prototype.mouseOut_=function(a){if(this.attr_("hideOverlayOnMouseOut")){this.clearSelection()}};Dygraph.prototype.clearSelection=function(){var a=this.canvas_.getContext("2d");a.clearRect(0,0,this.width_,this.height_);this.attr_("labelsDiv").innerHTML="";this.selPoints_=[];this.lastx_=-1};Dygraph.prototype.getSelection=function(){if(!this.selPoints_||this.selPoints_.length<1){return -1}for(var a=0;a<this.layout_.points.length;a++){if(this.layout_.points[a].x==this.selPoints_[0].x){return a+this.boundaryIds_[0][0]}}return -1};Dygraph.zeropad=function(a){if(a<10){return"0"+a}else{return""+a}};Dygraph.prototype.hmsString_=function(a){var c=Dygraph.zeropad;var b=new Date(a);if(b.getSeconds()){return c(b.getHours())+":"+c(b.getMinutes())+":"+c(b.getSeconds())}else{return c(b.getHours())+":"+c(b.getMinutes())}};Dygraph.dateString_=function(b,j){var c=Dygraph.zeropad;var g=new Date(b);var h=""+g.getFullYear();var e=c(g.getMonth()+1);var i=c(g.getDate());var f="";var a=g.getHours()*3600+g.getMinutes()*60+g.getSeconds();if(a){f=" "+j.hmsString_(b)}return h+"/"+e+"/"+i+f};Dygraph.round_=function(c,b){var a=Math.pow(10,b);return Math.round(c*a)/a};Dygraph.prototype.loadedEvent_=function(a){this.rawData_=this.parseCSV_(a);this.drawGraph_(this.rawData_)};Dygraph.prototype.months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];Dygraph.prototype.quarters=["Jan","Apr","Jul","Oct"];Dygraph.prototype.addXTicks_=function(){var a,c;if(this.dateWindow_){a=this.dateWindow_[0];c=this.dateWindow_[1]}else{a=this.rawData_[0][0];c=this.rawData_[this.rawData_.length-1][0]}var b=this.attr_("xTicker")(a,c,this);this.layout_.updateOptions({xTicks:b})};Dygraph.SECONDLY=0;Dygraph.TWO_SECONDLY=1;Dygraph.FIVE_SECONDLY=2;Dygraph.TEN_SECONDLY=3;Dygraph.THIRTY_SECONDLY=4;Dygraph.MINUTELY=5;Dygraph.TWO_MINUTELY=6;Dygraph.FIVE_MINUTELY=7;Dygraph.TEN_MINUTELY=8;Dygraph.THIRTY_MINUTELY=9;Dygraph.HOURLY=10;Dygraph.TWO_HOURLY=11;Dygraph.SIX_HOURLY=12;Dygraph.DAILY=13;Dygraph.WEEKLY=14;Dygraph.MONTHLY=15;Dygraph.QUARTERLY=16;Dygraph.BIANNUAL=17;Dygraph.ANNUAL=18;Dygraph.DECADAL=19;Dygraph.NUM_GRANULARITIES=20;Dygraph.SHORT_SPACINGS=[];Dygraph.SHORT_SPACINGS[Dygraph.SECONDLY]=1000*1;Dygraph.SHORT_SPACINGS[Dygraph.TWO_SECONDLY]=1000*2;Dygraph.SHORT_SPACINGS[Dygraph.FIVE_SECONDLY]=1000*5;Dygraph.SHORT_SPACINGS[Dygraph.TEN_SECONDLY]=1000*10;Dygraph.SHORT_SPACINGS[Dygraph.THIRTY_SECONDLY]=1000*30;Dygraph.SHORT_SPACINGS[Dygraph.MINUTELY]=1000*60;Dygraph.SHORT_SPACINGS[Dygraph.TWO_MINUTELY]=1000*60*2;Dygraph.SHORT_SPACINGS[Dygraph.FIVE_MINUTELY]=1000*60*5;Dygraph.SHORT_SPACINGS[Dygraph.TEN_MINUTELY]=1000*60*10;Dygraph.SHORT_SPACINGS[Dygraph.THIRTY_MINUTELY]=1000*60*30;Dygraph.SHORT_SPACINGS[Dygraph.HOURLY]=1000*3600;Dygraph.SHORT_SPACINGS[Dygraph.TWO_HOURLY]=1000*3600*2;Dygraph.SHORT_SPACINGS[Dygraph.SIX_HOURLY]=1000*3600*6;Dygraph.SHORT_SPACINGS[Dygraph.DAILY]=1000*86400;Dygraph.SHORT_SPACINGS[Dygraph.WEEKLY]=1000*604800;Dygraph.prototype.NumXTicks=function(e,b,g){if(g<Dygraph.MONTHLY){var h=Dygraph.SHORT_SPACINGS[g];return Math.floor(0.5+1*(b-e)/h)}else{var f=1;var d=12;if(g==Dygraph.QUARTERLY){d=3}if(g==Dygraph.BIANNUAL){d=2}if(g==Dygraph.ANNUAL){d=1}if(g==Dygraph.DECADAL){d=1;f=10}var c=365.2524*24*3600*1000;var a=1*(b-e)/c;return Math.floor(0.5+1*a*d/f)}};Dygraph.prototype.GetXAxis=function(n,k,a){var y=[];if(a<Dygraph.MONTHLY){var e=Dygraph.SHORT_SPACINGS[a];var u="%d%b";var v=e/1000;var w=new Date(n);if(v<=60){var h=w.getSeconds();w.setSeconds(h-h%v)}else{w.setSeconds(0);v/=60;if(v<=60){var h=w.getMinutes();w.setMinutes(h-h%v)}else{w.setMinutes(0);v/=60;if(v<=24){var h=w.getHours();w.setHours(h-h%v)}else{w.setHours(0);v/=24;if(v==7){w.setDate(w.getDate()-w.getDay())}}}}n=w.getTime();for(var l=n;l<=k;l+=e){var w=new Date(l);var b=w.getHours()*3600+w.getMinutes()*60+w.getSeconds();if(b==0||a>=Dygraph.DAILY){y.push({v:l,label:new Date(l+3600*1000).strftime(u)})}else{y.push({v:l,label:this.hmsString_(l)})}}}else{var f;var o=1;if(a==Dygraph.MONTHLY){f=[0,1,2,3,4,5,6,7,8,9,10,11,12]}else{if(a==Dygraph.QUARTERLY){f=[0,3,6,9]}else{if(a==Dygraph.BIANNUAL){f=[0,6]}else{if(a==Dygraph.ANNUAL){f=[0]}else{if(a==Dygraph.DECADAL){f=[0];o=10}}}}}var r=new Date(n).getFullYear();var p=new Date(k).getFullYear();var c=Dygraph.zeropad;for(var s=r;s<=p;s++){if(s%o!=0){continue}for(var q=0;q<f.length;q++){var m=s+"/"+c(1+f[q])+"/01";var l=Date.parse(m);if(l<n||l>k){continue}y.push({v:l,label:new Date(l).strftime("%b %y")})}}}return y};Dygraph.dateTicker=function(a,f,d){var b=-1;for(var e=0;e<Dygraph.NUM_GRANULARITIES;e++){var c=d.NumXTicks(a,f,e);if(d.width_/c>=d.attr_("pixelsPerXLabel")){b=e;break}}if(b>=0){return d.GetXAxis(a,f,b)}else{}};Dygraph.numericTicks=function(v,u,l){if(l.attr_("labelsKMG2")){var f=[1,2,4,8]}else{var f=[1,2,5]}var x,p,a,q;var h=l.attr_("pixelsPerYLabel");for(var t=-10;t<50;t++){if(l.attr_("labelsKMG2")){var c=Math.pow(16,t)}else{var c=Math.pow(10,t)}for(var s=0;s<f.length;s++){x=c*f[s];p=Math.floor(v/x)*x;a=Math.ceil(u/x)*x;q=Math.abs(a-p)/x;var d=l.height_/q;if(d>h){break}}if(d>h){break}}var w=[];var r;var o=[];if(l.attr_("labelsKMB")){r=1000;o=["K","M","B","T"]}if(l.attr_("labelsKMG2")){if(r){l.warn("Setting both labelsKMB and labelsKMG2. Pick one!")}r=1024;o=["k","M","G","T"]}if(p>a){x*=-1}for(var t=0;t<q;t++){var g=p+t*x;var b=Math.abs(g);var e=Dygraph.round_(g,2);if(o.length){var m=r*r*r*r;for(var s=3;s>=0;s--,m/=r){if(b>=m){e=Dygraph.round_(g/m,1)+o[s];break}}}w.push({label:e,v:g})}return w};Dygraph.prototype.addYTicks_=function(c,b){var a=Dygraph.numericTicks(c,b,this);this.layout_.updateOptions({yAxis:[c,b],yTicks:a})};Dygraph.prototype.extremeValues_=function(d){var h=null,f=null;var b=this.attr_("errorBars")||this.attr_("customBars");if(b){for(var c=0;c<d.length;c++){var g=d[c][1][0];if(!g){continue}var a=g-d[c][1][1];var e=g+d[c][1][2];if(a>g){a=g}if(e<g){e=g}if(f==null||e>f){f=e}if(h==null||a<h){h=a}}}else{for(var c=0;c<d.length;c++){var g=d[c][1];if(g===null||isNaN(g)){continue}if(f==null||g>f){f=g}if(h==null||g<h){h=g}}}return[h,f]};Dygraph.prototype.drawGraph_=function(C){var n=this.is_initial_draw_;this.is_initial_draw_=false;var y=null,x=null;this.layout_.removeAllDatasets();this.setColors_();this.attrs_.pointSize=0.5*this.attr_("highlightCircleSize");var b=this.attr_("connectSeparatedPoints");var d=[];var h=[];for(var w=1;w<C[0].length;w++){if(!this.visibility()[w-1]){continue}var g=[];for(var u=0;u<C.length;u++){if(C[u][w]||!b){var z=C[u][0];g.push([z,C[u][w]])}}g=this.rollingAverage(g,this.rollPeriod_);var p=this.attr_("errorBars")||this.attr_("customBars");if(this.dateWindow_){var E=this.dateWindow_[0];var f=this.dateWindow_[1];var q=[];var e=null,D=null;for(var t=0;t<g.length;t++){if(g[t][0]>=E&&e===null){e=t}if(g[t][0]<=f){D=t}}if(e===null){e=0}if(e>0){e--}if(D===null){D=g.length-1}if(D<g.length-1){D++}this.boundaryIds_[w-1]=[e,D];for(var t=e;t<=D;t++){q.push(g[t])}g=q}else{this.boundaryIds_[w-1]=[0,g.length-1]}var a=this.extremeValues_(g);var r=a[0];var o=a[1];if(!y||r<y){y=r}if(!x||o>x){x=o}if(p){var m=[];for(var u=0;u<g.length;u++){m[u]=[g[u][0],g[u][1][0],g[u][1][1],g[u][1][2]]}this.layout_.addDataset(this.attr_("labels")[w],m)}else{if(this.attr_("stackedGraph")){var m=[];var s=g.length;var A;for(var u=0;u<s;u++){if(d[g[u][0]]===undefined){d[g[u][0]]=0}A=g[u][1];d[g[u][0]]+=A;m[u]=[g[u][0],d[g[u][0]]];if(!x||d[g[u][0]] >x){x=d[g[u][0]]}}h.push([this.attr_("labels")[w],m])}else{this.layout_.addDataset(this.attr_("labels")[w],g)}}}if(h.length>0){for(var w=(h.length-1);w>=0;w--){this.layout_.addDataset(h[w][0],h[w][1])}}if(this.valueRange_!=null){this.addYTicks_(this.valueRange_[0],this.valueRange_[1]);this.displayedYRange_=this.valueRange_}else{if(this.attr_("includeZero")&&y>0){y=0}var v=x-y;if(v==0){v=x}var c=x+0.1*v;var B=y-0.1*v;if(B<0&&y>=0){B=0}if(c>0&&x<=0){c=0}if(this.attr_("includeZero")){if(x<0){c=0}if(y>0){B=0}}this.addYTicks_(B,c);this.displayedYRange_=[B,c]}this.addXTicks_();this.layout_.updateOptions({dateWindow:this.dateWindow_});this.layout_.evaluateWithError();this.plotter_.clear();this.plotter_.render();this.canvas_.getContext("2d").clearRect(0,0,this.canvas_.width,this.canvas_.height);if(this.attr_("drawCallback")!==null){this.attr_("drawCallback")(this,n)}};Dygraph.prototype.rollingAverage=function(m,d){if(m.length<2){return m}var d=Math.min(d,m.length-1);var b=[];var s=this.attr_("sigma");if(this.fractions_){var k=0;var h=0;var e=100;for(var x=0;x<m.length;x++){k+=m[x][1][0];h+=m[x][1][1];if(x-d>=0){k-=m[x-d][1][0];h-=m[x-d][1][1]}var B=m[x][0];var v=h?k/h:0;if(this.attr_("errorBars")){if(this.wilsonInterval_){if(h){var t=v<0?0:v,u=h;var A=s*Math.sqrt(t*(1-t)/u+s*s/(4*u*u));var a=1+s*s/h;var F=(t+s*s/(2*h)-A)/a;var o=(t+s*s/(2*h)+A)/a;b[x]=[B,[t*e,(t-F)*e,(o-t)*e]]}else{b[x]=[B,[0,0,0]]}}else{var z=h?s*Math.sqrt(v*(1-v)/h):1;b[x]=[B,[e*v,e*z,e*z]]}}else{b[x]=[B,e*v]}}}else{if(this.attr_("customBars")){var F=0;var C=0;var o=0;var g=0;for(var x=0;x<m.length;x++){var E=m[x][1];var l=E[1];b[x]=[m[x][0],[l,l-E[0],E[2]-l]];if(l!=null&&!isNaN(l)){F+=E[0];C+=l;o+=E[2];g+=1}if(x-d>=0){var r=m[x-d];if(r[1][1]!=null&&!isNaN(r[1][1])){F-=r[1][0];C-=r[1][1];o-=r[1][2];g-=1}}b[x]=[m[x][0],[1*C/g,1*(C-F)/g,1*(o-C)/g]]}}else{var q=Math.min(d-1,m.length-2);if(!this.attr_("errorBars")){if(d==1){return m}for(var x=0;x<m.length;x++){var c=0;var D=0;for(var w=Math.max(0,x-d+1);w<x+1;w++){var l=m[w][1];if(l==null||isNaN(l)){continue}D++;c+=m[w][1]}if(D){b[x]=[m[x][0],c/D]}else{b[x]=[m[x][0],null]}}}else{for(var x=0;x<m.length;x++){var c=0;var f=0;var D=0;for(var w=Math.max(0,x-d+1);w<x+1;w++){var l=m[w][1][0];if(l==null||isNaN(l)){continue}D++;c+=m[w][1][0];f+=Math.pow(m[w][1][1],2)}if(D){var z=Math.sqrt(f)/D;b[x]=[m[x][0],[c/D,s*z,s*z]]}else{b[x]=[m[x][0],[null,null,null]]}}}}}return b};Dygraph.dateParser=function(b,a){var c;var e;if(b.search("-")!=-1){c=b.replace("-","/","g");while(c.search("-")!=-1){c=c.replace("-","/")}e=Date.parse(c)}else{if(b.length==8){c=b.substr(0,4)+"/"+b.substr(4,2)+"/"+b.substr(6,2);e=Date.parse(c)}else{e=Date.parse(b)}}if(!e||isNaN(e)){a.error("Couldn\'t parse "+b+" as a date")}return e};Dygraph.prototype.detectTypeFromString_=function(b){var a=false;if(b.indexOf("-")>=0||b.indexOf("/")>=0||isNaN(parseFloat(b))){a=true}else{if(b.length==8&&b>"19700101"&&b<"20371231"){a=true}}if(a){this.attrs_.xValueFormatter=Dygraph.dateString_;this.attrs_.xValueParser=Dygraph.dateParser;this.attrs_.xTicker=Dygraph.dateTicker}else{this.attrs_.xValueFormatter=function(c){return c};this.attrs_.xValueParser=function(c){return parseFloat(c)};this.attrs_.xTicker=Dygraph.numericTicks}};Dygraph.prototype.parseCSV_=function(h){var m=[];var q=h.split("\\n");var b=this.attr_("delimiter");if(q[0].indexOf(b)==-1&&q[0].indexOf("\\t")>=0){b="\\t"}var a=0;if(this.labelsFromCSV_){a=1;this.attrs_.labels=q[0].split(b)}var c;var o=false;var d=this.attr_("labels").length;var l=false;for(var g=a;g<q.length;g++){var p=q[g];if(p.length==0){continue}if(p[0]=="#"){continue}var f=p.split(b);if(f.length<2){continue}var k=[];if(!o){this.detectTypeFromString_(f[0]);c=this.attr_("xValueParser");o=true}k[0]=c(f[0],this);if(this.fractions_){for(var e=1;e<f.length;e++){var n=f[e].split("/");k[e]=[parseFloat(n[0]),parseFloat(n[1])]}}else{if(this.attr_("errorBars")){for(var e=1;e<f.length;e+=2){k[(e+1)/2]=[parseFloat(f[e]),parseFloat(f[e+1])]}}else{if(this.attr_("customBars")){for(var e=1;e<f.length;e++){var n=f[e].split(";");k[e]=[parseFloat(n[0]),parseFloat(n[1]),parseFloat(n[2])]}}else{for(var e=1;e<f.length;e++){k[e]=parseFloat(f[e])}}}}if(m.length>0&&k[0]<m[m.length-1][0]){l=true}m.push(k);if(k.length!=d){this.error("Number of columns in line "+g+" ("+k.length+") does not agree with number of labels ("+d+") "+p)}}if(l){this.warn("CSV is out of order; order it correctly to speed loading.");m.sort(function(j,i){return j[0]-i[0]})}return m};Dygraph.prototype.parseArray_=function(b){if(b.length==0){this.error("Can\'t plot empty data set");return null}if(b[0].length==0){this.error("Data set cannot contain an empty row");return null}if(this.attr_("labels")==null){this.warn("Using default labels. Set labels explicitly via \'labels\' in the options parameter");this.attrs_.labels=["X"];for(var a=1;a<b[0].length;a++){this.attrs_.labels.push("Y"+a)}}if(Dygraph.isDateLike(b[0][0])){this.attrs_.xValueFormatter=Dygraph.dateString_;this.attrs_.xTicker=Dygraph.dateTicker;var c=Dygraph.clone(b);for(var a=0;a<b.length;a++){if(c[a].length==0){this.error("Row "<<(1+a)<<" of data is empty");return null}if(c[a][0]==null||typeof(c[a][0].getTime)!="function"||isNaN(c[a][0].getTime())){this.error("x value in row "+(1+a)+" is not a Date");return null}c[a][0]=c[a][0].getTime()}return c}else{this.attrs_.xValueFormatter=function(d){return d};this.attrs_.xTicker=Dygraph.numericTicks;return b}};Dygraph.prototype.parseDataTable_=function(c){var h=c.getNumberOfColumns();var l=c.getNumberOfRows();var e=[];for(var d=0;d<h;d++){e.push(c.getColumnLabel(d));if(d!=0&&this.attr_("errorBars")){d+=1}}this.attrs_.labels=e;h=e.length;var a=c.getColumnType(0);if(a=="date"||a=="datetime"){this.attrs_.xValueFormatter=Dygraph.dateString_;this.attrs_.xValueParser=Dygraph.dateParser;this.attrs_.xTicker=Dygraph.dateTicker}else{if(a=="number"){this.attrs_.xValueFormatter=function(i){return i};this.attrs_.xValueParser=function(i){return parseFloat(i)};this.attrs_.xTicker=Dygraph.numericTicks}else{this.error("only \'date\', \'datetime\' and \'number\' types are supported for column 1 of DataTable input (Got \'"+a+"\')");return null}}var g=[];var f=false;for(var d=0;d<l;d++){var k=[];if(typeof(c.getValue(d,0))==="undefined"||c.getValue(d,0)===null){this.warning("Ignoring row "+d+" of DataTable because of undefined or null first column.");continue}if(a=="date"||a=="datetime"){k.push(c.getValue(d,0).getTime())}else{k.push(c.getValue(d,0))}if(!this.attr_("errorBars")){for(var b=1;b<h;b++){k.push(c.getValue(d,b))}}else{for(var b=0;b<h-1;b++){k.push([c.getValue(d,1+2*b),c.getValue(d,2+2*b)])}}if(g.length>0&&k[0]<g[g.length-1][0]){f=true}g.push(k)}if(f){this.warn("DataTable is out of order; order it correctly to speed loading.");g.sort(function(j,i){return j[0]-i[0]})}return g};Dygraph.update=function(b,c){if(typeof(c)!="undefined"&&c!==null){for(var a in c){if(c.hasOwnProperty(a)){b[a]=c[a]}}}return b};Dygraph.isArrayLike=function(b){var a=typeof(b);if((a!="object"&&!(a=="function"&&typeof(b.item)=="function"))||b===null||typeof(b.length)!="number"||b.nodeType===3){return false}return true};Dygraph.isDateLike=function(a){if(typeof(a)!="object"||a===null||typeof(a.getTime)!="function"){return false}return true};Dygraph.clone=function(c){var b=[];for(var a=0;a<c.length;a++){if(Dygraph.isArrayLike(c[a])){b.push(Dygraph.clone(c[a]))}else{b.push(c[a])}}return b};Dygraph.prototype.start_=function(){if(typeof this.file_=="function"){this.loadedEvent_(this.file_())}else{if(Dygraph.isArrayLike(this.file_)){this.rawData_=this.parseArray_(this.file_);this.drawGraph_(this.rawData_)}else{if(typeof this.file_=="object"&&typeof this.file_.getColumnRange=="function"){this.rawData_=this.parseDataTable_(this.file_);this.drawGraph_(this.rawData_)}else{if(typeof this.file_=="string"){if(this.file_.indexOf("\\n")>=0){this.loadedEvent_(this.file_)}else{var b=new XMLHttpRequest();var a=this;b.onreadystatechange=function(){if(b.readyState==4){if(b.status==200){a.loadedEvent_(b.responseText)}}};b.open("GET",this.file_,true);b.send(null)}}else{this.error("Unknown data format: "+(typeof this.file_))}}}}};Dygraph.prototype.updateOptions=function(a){if(a.rollPeriod){this.rollPeriod_=a.rollPeriod}if(a.dateWindow){this.dateWindow_=a.dateWindow}if(a.valueRange){this.valueRange_=a.valueRange}Dygraph.update(this.user_attrs_,a);this.labelsFromCSV_=(this.attr_("labels")==null);this.layout_.updateOptions({errorBars:this.attr_("errorBars")});if(a.file){this.file_=a.file;this.start_()}else{this.drawGraph_(this.rawData_)}};Dygraph.prototype.resize=function(b,a){if((b===null)!=(a===null)){this.warn("Dygraph.resize() should be called with zero parameters or two non-NULL parameters. Pretending it was zero.");b=a=null}this.maindiv_.innerHTML="";this.attrs_.labelsDiv=null;if(b){this.maindiv_.style.width=b+"px";this.maindiv_.style.height=a+"px";this.width_=b;this.height_=a}else{this.width_=this.maindiv_.offsetWidth;this.height_=this.maindiv_.offsetHeight}this.createInterface_();this.drawGraph_(this.rawData_)};Dygraph.prototype.adjustRoll=function(a){this.rollPeriod_=a;this.drawGraph_(this.rawData_)};Dygraph.prototype.visibility=function(){if(!this.attr_("visibility")){this.attrs_.visibility=[]}while(this.attr_("visibility").length<this.rawData_[0].length-1){this.attr_("visibility").push(true)}return this.attr_("visibility")};Dygraph.prototype.setVisibility=function(b,c){var a=this.visibility();if(b<0&&b>=a.length){this.warn("invalid series number in setVisibility: "+b)}else{a[b]=c;this.drawGraph_(this.rawData_)}};Dygraph.createCanvas=function(){var a=document.createElement("canvas");isIE=(/MSIE/.test(navigator.userAgent)&&!window.opera);if(isIE){a=G_vmlCanvasManager.initElement(a)}return a};Dygraph.GVizChart=function(a){this.container=a};Dygraph.GVizChart.prototype.draw=function(b,a){this.container.innerHTML="";this.date_graph=new Dygraph(this.container,b,a)};Dygraph.GVizChart.prototype.setSelection=function(b){var a=false;if(b.length){a=b[0].row}this.date_graph.setSelection(a)};Dygraph.GVizChart.prototype.getSelection=function(){var b=[];var c=this.date_graph.getSelection();if(c<0){return b}col=1;for(var a in this.date_graph.layout_.datasets){b.push({row:c,column:col});col++}return b};DateGraph=Dygraph;function RGBColor(g){this.ok=false;if(g.charAt(0)=="#"){g=g.substr(1,6)}g=g.replace(/ /g,"");g=g.toLowerCase();var a={aliceblue:"f0f8ff",antiquewhite:"faebd7",aqua:"00ffff",aquamarine:"7fffd4",azure:"f0ffff",beige:"f5f5dc",bisque:"ffe4c4",black:"000000",blanchedalmond:"ffebcd",blue:"0000ff",blueviolet:"8a2be2",brown:"a52a2a",burlywood:"deb887",cadetblue:"5f9ea0",chartreuse:"7fff00",chocolate:"d2691e",coral:"ff7f50",cornflowerblue:"6495ed",cornsilk:"fff8dc",crimson:"dc143c",cyan:"00ffff",darkblue:"00008b",darkcyan:"008b8b",darkgoldenrod:"b8860b",darkgray:"a9a9a9",darkgreen:"006400",darkkhaki:"bdb76b",darkmagenta:"8b008b",darkolivegreen:"556b2f",darkorange:"ff8c00",darkorchid:"9932cc",darkred:"8b0000",darksalmon:"e9967a",darkseagreen:"8fbc8f",darkslateblue:"483d8b",darkslategray:"2f4f4f",darkturquoise:"00ced1",darkviolet:"9400d3",deeppink:"ff1493",deepskyblue:"00bfff",dimgray:"696969",dodgerblue:"1e90ff",feldspar:"d19275",firebrick:"b22222",floralwhite:"fffaf0",forestgreen:"228b22",fuchsia:"ff00ff",gainsboro:"dcdcdc",ghostwhite:"f8f8ff",gold:"ffd700",goldenrod:"daa520",gray:"808080",green:"008000",greenyellow:"adff2f",honeydew:"f0fff0",hotpink:"ff69b4",indianred:"cd5c5c",indigo:"4b0082",ivory:"fffff0",khaki:"f0e68c",lavender:"e6e6fa",lavenderblush:"fff0f5",lawngreen:"7cfc00",lemonchiffon:"fffacd",lightblue:"add8e6",lightcoral:"f08080",lightcyan:"e0ffff",lightgoldenrodyellow:"fafad2",lightgrey:"d3d3d3",lightgreen:"90ee90",lightpink:"ffb6c1",lightsalmon:"ffa07a",lightseagreen:"20b2aa",lightskyblue:"87cefa",lightslateblue:"8470ff",lightslategray:"778899",lightsteelblue:"b0c4de",lightyellow:"ffffe0",lime:"00ff00",limegreen:"32cd32",linen:"faf0e6",magenta:"ff00ff",maroon:"800000",mediumaquamarine:"66cdaa",mediumblue:"0000cd",mediumorchid:"ba55d3",mediumpurple:"9370d8",mediumseagreen:"3cb371",mediumslateblue:"7b68ee",mediumspringgreen:"00fa9a",mediumturquoise:"48d1cc",mediumvioletred:"c71585",midnightblue:"191970",mintcream:"f5fffa",mistyrose:"ffe4e1",moccasin:"ffe4b5",navajowhite:"ffdead",navy:"000080",oldlace:"fdf5e6",olive:"808000",olivedrab:"6b8e23",orange:"ffa500",orangered:"ff4500",orchid:"da70d6",palegoldenrod:"eee8aa",palegreen:"98fb98",paleturquoise:"afeeee",palevioletred:"d87093",papayawhip:"ffefd5",peachpuff:"ffdab9",peru:"cd853f",pink:"ffc0cb",plum:"dda0dd",powderblue:"b0e0e6",purple:"800080",red:"ff0000",rosybrown:"bc8f8f",royalblue:"4169e1",saddlebrown:"8b4513",salmon:"fa8072",sandybrown:"f4a460",seagreen:"2e8b57",seashell:"fff5ee",sienna:"a0522d",silver:"c0c0c0",skyblue:"87ceeb",slateblue:"6a5acd",slategray:"708090",snow:"fffafa",springgreen:"00ff7f",steelblue:"4682b4",tan:"d2b48c",teal:"008080",thistle:"d8bfd8",tomato:"ff6347",turquoise:"40e0d0",violet:"ee82ee",violetred:"d02090",wheat:"f5deb3",white:"ffffff",whitesmoke:"f5f5f5",yellow:"ffff00",yellowgreen:"9acd32"};for(var c in a){if(g==c){g=a[c]}}var h=[{re:/^rgb\\((\\d{1,3}),\\s*(\\d{1,3}),\\s*(\\d{1,3})\\)$/,example:["rgb(123, 234, 45)","rgb(255,234,245)"],process:function(i){return[parseInt(i[1]),parseInt(i[2]),parseInt(i[3])]}},{re:/^(\\w{2})(\\w{2})(\\w{2})$/,example:["#00ff00","336699"],process:function(i){return[parseInt(i[1],16),parseInt(i[2],16),parseInt(i[3],16)]}},{re:/^(\\w{1})(\\w{1})(\\w{1})$/,example:["#fb0","f0f"],process:function(i){return[parseInt(i[1]+i[1],16),parseInt(i[2]+i[2],16),parseInt(i[3]+i[3],16)]}}];for(var b=0;b<h.length;b++){var e=h[b].re;var d=h[b].process;var f=e.exec(g);if(f){channels=d(f);this.r=channels[0];this.g=channels[1];this.b=channels[2];this.ok=true}}this.r=(this.r<0||isNaN(this.r))?0:((this.r>255)?255:this.r);this.g=(this.g<0||isNaN(this.g))?0:((this.g>255)?255:this.g);this.b=(this.b<0||isNaN(this.b))?0:((this.b>255)?255:this.b);this.toRGB=function(){return"rgb("+this.r+", "+this.g+", "+this.b+")"};this.toHex=function(){var k=this.r.toString(16);var j=this.g.toString(16);var i=this.b.toString(16);if(k.length==1){k="0"+k}if(j.length==1){j="0"+j}if(i.length==1){i="0"+i}return"#"+k+j+i}}Date.ext={};Date.ext.util={};Date.ext.util.xPad=function(a,c,b){if(typeof(b)=="undefined"){b=10}for(;parseInt(a,10)<b&&b>1;b/=10){a=c.toString()+a}return a.toString()};Date.prototype.locale="en-GB";if(document.getElementsByTagName("html")&&document.getElementsByTagName("html")[0].lang){Date.prototype.locale=document.getElementsByTagName("html")[0].lang}Date.ext.locales={};Date.ext.locales.en={a:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],A:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],b:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],B:["January","February","March","April","May","June","July","August","September","October","November","December"],c:"%a %d %b %Y %T %Z",p:["AM","PM"],P:["am","pm"],x:"%d/%m/%y",X:"%T"};Date.ext.locales["en-US"]=Date.ext.locales.en;Date.ext.locales["en-US"].c="%a %d %b %Y %r %Z";Date.ext.locales["en-US"].x="%D";Date.ext.locales["en-US"].X="%r";Date.ext.locales["en-GB"]=Date.ext.locales.en;Date.ext.locales["en-AU"]=Date.ext.locales["en-GB"];Date.ext.formats={a:function(a){return Date.ext.locales[a.locale].a[a.getDay()]},A:function(a){return Date.ext.locales[a.locale].A[a.getDay()]},b:function(a){return Date.ext.locales[a.locale].b[a.getMonth()]},B:function(a){return Date.ext.locales[a.locale].B[a.getMonth()]},c:"toLocaleString",C:function(a){return Date.ext.util.xPad(parseInt(a.getFullYear()/100,10),0)},d:["getDate","0"],e:["getDate"," "],g:function(a){return Date.ext.util.xPad(parseInt(Date.ext.util.G(a)/100,10),0)},G:function(c){var e=c.getFullYear();var b=parseInt(Date.ext.formats.V(c),10);var a=parseInt(Date.ext.formats.W(c),10);if(a>b){e++}else{if(a===0&&b>=52){e--}}return e},H:["getHours","0"],I:function(b){var a=b.getHours()%12;return Date.ext.util.xPad(a===0?12:a,0)},j:function(c){var a=c-new Date(""+c.getFullYear()+"/1/1 GMT");a+=c.getTimezoneOffset()*60000;var b=parseInt(a/60000/60/24,10)+1;return Date.ext.util.xPad(b,0,100)},m:function(a){return Date.ext.util.xPad(a.getMonth()+1,0)},M:["getMinutes","0"],p:function(a){return Date.ext.locales[a.locale].p[a.getHours()>=12?1:0]},P:function(a){return Date.ext.locales[a.locale].P[a.getHours()>=12?1:0]},S:["getSeconds","0"],u:function(a){var b=a.getDay();return b===0?7:b},U:function(e){var a=parseInt(Date.ext.formats.j(e),10);var c=6-e.getDay();var b=parseInt((a+c)/7,10);return Date.ext.util.xPad(b,0)},V:function(e){var c=parseInt(Date.ext.formats.W(e),10);var a=(new Date(""+e.getFullYear()+"/1/1")).getDay();var b=c+(a>4||a<=1?0:1);if(b==53&&(new Date(""+e.getFullYear()+"/12/31")).getDay()<4){b=1}else{if(b===0){b=Date.ext.formats.V(new Date(""+(e.getFullYear()-1)+"/12/31"))}}return Date.ext.util.xPad(b,0)},w:"getDay",W:function(e){var a=parseInt(Date.ext.formats.j(e),10);var c=7-Date.ext.formats.u(e);var b=parseInt((a+c)/7,10);return Date.ext.util.xPad(b,0,10)},y:function(a){return Date.ext.util.xPad(a.getFullYear()%100,0)},Y:"getFullYear",z:function(c){var b=c.getTimezoneOffset();var a=Date.ext.util.xPad(parseInt(Math.abs(b/60),10),0);var e=Date.ext.util.xPad(b%60,0);return(b>0?"-":"+")+a+e},Z:function(a){return a.toString().replace(/^.*\\(([^)]+)\\)$/,"$1")},"%":function(a){return"%"}};Date.ext.aggregates={c:"locale",D:"%m/%d/%y",h:"%b",n:"\\n",r:"%I:%M:%S %p",R:"%H:%M",t:"\\t",T:"%H:%M:%S",x:"locale",X:"locale"};Date.ext.aggregates.z=Date.ext.formats.z(new Date());Date.ext.aggregates.Z=Date.ext.formats.Z(new Date());Date.ext.unsupported={};Date.prototype.strftime=function(a){if(!(this.locale in Date.ext.locales)){if(this.locale.replace(/-[a-zA-Z]+$/,"") in Date.ext.locales){this.locale=this.locale.replace(/-[a-zA-Z]+$/,"")}else{this.locale="en-GB"}}var c=this;while(a.match(/%[cDhnrRtTxXzZ]/)){a=a.replace(/%([cDhnrRtTxXzZ])/g,function(e,d){var g=Date.ext.aggregates[d];return(g=="locale"?Date.ext.locales[c.locale][d]:g)})}var b=a.replace(/%([aAbBCdegGHIjmMpPSuUVwWyY%])/g,function(e,d){var g=Date.ext.formats[d];if(typeof(g)=="string"){return c[g]()}else{if(typeof(g)=="function"){return g.call(c,c)}else{if(typeof(g)=="object"&&typeof(g[0])=="string"){return Date.ext.util.xPad(c[g[0]](),g[1])}else{return d}}}});c=null;return b};';
