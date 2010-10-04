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
    latencyConf: {percentiles: [.95,.99]}   // Set latencyConf.percentiles to percentiles to report for the 'latency' stat
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

/** addTest(spec) is the primary method to create a load test with nodeloadlib. See TEST_DEFAULTS for a list
    of the configuration values that can be provided in the test specification, spec. Remember to call
    startTests() to kick off the tests defined though addTest(spec)/addRamp(spec). 
    
    The returned test.stats is a map of { 'latency': Reportable(Histogram), 'result-codes': Reportable(ResultsCounter}, 
    'uniques': Reportable(Uniques), 'concurrency': Reportable(Peak) }
    */
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
    var test = {
        spec: spec,
        stats: stats,
        jobs: jobs,
        fun: monitored
    }

    TEST_MONITOR.addTest(test);
    
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
    TEST_MONITOR.start();
    SCHEDULER.startAll(testsComplete(callback, stayAliveAfterDone));
}

/** A convenience function equivalent to addTest() followed by startTests() */
runTest = function(spec, callback, stayAliveAfterDone) {
    var t = addTest(spec);
    startTests(callback, stayAliveAfterDone);
    return t;
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
/** Returns a callback function that should be called at the end of the load test. It calls the user
    specified callback function and sets a timer for terminating the nodeload process if no new tests
    are started by the user specified callback. */
function testsComplete(callback, stayAliveAfterDone) {
    return function() {
        TEST_MONITOR.stop();
        if (callback != null)
            callback();
        if (SLAVE_CONFIG == null && !stayAliveAfterDone)
            checkToExitProcess();
    }
}

/** Wait 3 seconds and check if anyone has restarted SCHEDULER (i.e. more tests). End process if not. */
function checkToExitProcess() {
    setTimeout(function() {
        if (!SCHEDULER.running) {
            qputs("\nFinishing...");
            closeAllLogs();
            stopHttpServer();
            setTimeout(process.exit, 500);
        }
    }, 3000);
}