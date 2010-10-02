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
    reportFun: null,                        // Function called each REPORT_INTERVAL that takes a param, test, which refers to 
                                            // the current test. test.stats is a map of { 'latency': Reportable(Histogram), 
                                            // 'result-codes': Reportable(ResultsCounter}, 'uniques': Reportable(Uniques),
                                            // 'concurrency': Reportable(Peak) }
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

var LOAD_TESTS = [];

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
    var report = new Report(spec.name, updateReportFromStats(stats));
    var test = {
        spec: spec,
        stats: stats,
        report: report,
        jobs: jobs,
        fun: monitored
    }

    STATS_MANAGER.addStats(stats);
    REPORT_MANAGER.addReport(report);
    LOAD_TESTS.push(test);
    
    return test;
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
    TEST_MONITOR.prepareForTest();
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
    } else {
        refreshPeriod = 2000;
    }

    SUMMARY_HTML_REFRESH_PERIOD = refreshPeriod;
    TEST_MONITOR.interval = refreshPeriod;
}

// =================
// Private methods
// =================
var endTestTimeoutId;

/** The global test monitor. Register functions here that should be run at regular intervals
    during the load test, such as processing & logging statistics. */
var TEST_MONITOR = {
    interval: 2000,
    funs: [ callUserReportFuns ],
    jobs: null,
    register: function(fun) {
        this.funs.push(fun);
    },
    prepareForTest: function() {
        var funs = this.funs;
        var tick = function() { for (var i in funs) { funs[i](); } }
        jobs = SCHEDULER.schedule({
            fun: funLoop(tick),
            rps: 1000/this.interval,
            delay: this.interval/1000,
            monitored: false
        });
    }
}

function callUserReportFuns() {
    for (var i in LOAD_TESTS)
        if (LOAD_TESTS[i].spec.reportFun != null)
            LOAD_TESTS[i].spec.reportFun(LOAD_TEST[i]);
    qprint('.');
}

/** Returns a callback function that should be called at the end of the load test. It generates the
    summary file and calls the user specified callback function. It sets a timer for terminating 
    the nodeload process if no new tests are started by the user specified callback. */
function testsComplete(callback, stayAliveAfterDone) {
    return function() {
        qprint('done.\n');
        summaryReport(summaryStats);
        STATS_MANAGER.reset();
        REPORT_MANAGER.reset();
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

// Initialize test configuration parameters (logging interval, etc) 
if (typeof REPORT_INTERVAL != "undefined") {
    TEST_MONITOR.interval = REPORT_INTERVAL;
}