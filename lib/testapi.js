// ------------------------------------
// Main HTTP load testing interface
// ------------------------------------
//
// This file defines addTest, addRamp, startTests, runTest and traceableRequest.
//
// This file defines the public API for using nodeload to construct load tests.
//

/** TEST_DEFAULTS defines all of the parameters that can be set in a test specifiction passed to
addTest(spec). By default, a test will GET localhost:8080/ as fast as possible with 10 users for 2
minutes. */
var TEST_DEFAULTS = {
    name: 'Debug test',                     // A descriptive name for the test

    host: 'localhost',                      // host and port specify where to connect
    port: 8080,                             //
    requestGenerator: null,                 // Specify one of:
                                            //   1. requestGenerator: a function
                                            //         function(http.Client) ->  http.ClientRequest
    requestLoop: null,                      //   2. requestLoop: is a function
                                            //         function(loopFun, http.Client)
                                            //     It must call
                                            //         loopFun({
                                            //             req: http.ClientRequest, 
                                            //             res: http.ClientResponse});
                                            //     after each transaction to finishes to schedule the 
                                            //     next iteration of requestLoop.
    method: 'GET',                          //   3. (method + path + requestData) specify a single URL to
    path: '/',                              //     test
    requestData: null,                      //
                                            //
    numClients: 10,                         // Maximum number of concurrent executions of request loop
    numRequests: Infinity,                  // Maximum number of iterations of request loop
    timeLimit: 120,                         // Maximum duration of test in seconds
    targetRps: Infinity,                    // Number of times per second to execute request loop
    delay: 0,                               // Seconds before starting test
                                            //
    successCodes: null,                     // List of success HTTP response codes. Non-success responses
                                            // are logged to the error log.
    stats: ['latency',                      // Specify list of: 'latency', 'result-codes', 'uniques', 
            'result-codes'],                // 'concurrency'. Note that 'uniques' only shows up in
                                            // Cumulative section of the report. traceableRequest() must
                                            // be used for requets or only 2 uniques will be detected.
    latencyConf: {                          // Set latencyConf.percentiles to percentiles to report for 
        percentiles: [0.95,0.99]            // the 'latency' stat.
    }                                       //
};

/** RAMP_DEFAULTS defines all of the parameters that can be set in a ramp-up specifiction passed to
addRamp(spec). By default, a ramp will add 100 requests/sec over 10 seconds, adding 1 user each second.
*/
var RAMP_DEFAULTS = {
    test: null,                         // The test to ramp up, returned from from addTest()
    numberOfSteps: 10,                  // Number of steps in ramp
    timeLimit: 10,                      // The total number of seconds to ramp up
    rpsPerStep: 10,                     // The rps to add to the test at each step
    clientsPerStep: 1,                  // The number of connections to add to the test at each step.
    delay: 0                            // Number of seconds to wait before ramping up. 
};

/** addTest(spec) is the primary method to create a load test with nodeloadlib. See TEST_DEFAULTS for a
list of the configuration values that can be provided in the test specification, spec. Remember to call
startTests() to kick off the tests defined though addTest(spec)/addRamp(spec).

@return A test object:
    {
        spec: the spec passed to addTest() to create this test
        stats: { 
            'latency': Reportable(Histogram), 
            'result-codes': Reportable(ResultsCounter}, 
            'uniques': Reportable(Uniques), 
            'concurrency': Reportable(Peak)
        }
        jobs: jobs scheduled in SCHEDULER for this test
        fun: the function being run by each job in jobs 
    }
*/
var addTest = exports.addTest = function(spec) {
    Utils.defaults(spec, TEST_DEFAULTS);

    var req = function(client) {
            if (spec.requestGenerator !== null) {
                return spec.requestGenerator(client);
            }

            return traceableRequest(client, spec.method, spec.path, { 'host': spec.host }, spec.requestData);
        },
        test = { 
            spec: spec, 
            stats: {}, 
            jobs: [], 
            fun: spec.requestLoop || LoopUtils.requestGeneratorLoop(req) 
        };

    if (spec.stats.indexOf('latency') >= 0) {
        var l = new Reportable([Histogram, spec.latencyConf], spec.name + ': Latency', true);
        test.fun = LoopUtils.monitorLatenciesLoop(l, test.fun);
        test.stats['latency'] = l;
    }
    if (spec.stats.indexOf('result-codes') >= 0) {
        var rc = new Reportable(ResultsCounter, spec.name + ': Result codes', true);
        test.fun = LoopUtils.monitorResultsLoop(rc, test.fun);
        test.stats['result-codes'] = rc;
    }
    if (spec.stats.indexOf('concurrency') >= 0) {
        var conc = new Reportable(Peak, spec.name + ': Concurrency', true);
        test.fun = LoopUtils.monitorConcurrencyLoop(conc, test.fun);
        test.stats['concurrency'] = conc;
    }
    if (spec.stats.indexOf('uniques') >= 0) {
        var uniq = new Reportable(Uniques, spec.name + ': Uniques', false);
        test.fun = LoopUtils.monitorUniqueUrlsLoop(uniq, test.fun);
        test.stats['uniques'] = uniq;
    }
    if (spec.stats.indexOf('bytes') >= 0) {
        var reqbytes = new Reportable(Accumulator, spec.name + ': Request Bytes', true);
        test.fun = LoopUtils.monitorByteSentLoop(reqbytes, test.fun);
        test.stats['request-bytes'] = reqbytes;

        var resbytes = new Reportable(Accumulator, spec.name + ': Response Bytes', true);
        test.fun = LoopUtils.monitorByteReceivedLoop(resbytes, test.fun);
        test.stats['response-bytes'] = resbytes;
    }
    if (spec.successCodes !== null) {
        test.fun = LoopUtils.monitorHttpFailuresLoop(spec.successCodes, test.fun);
    }
    
    test.jobs = SCHEDULER.schedule({
        fun: test.fun,
        argGenerator: function() { return http.createClient(spec.port, spec.host) },
        concurrency: spec.numClients,
        rps: spec.targetRps,
        duration: spec.timeLimit,
        numberOfTimes: spec.numRequests,
        delay: spec.delay
    });

    TEST_MONITOR.addTest(test);
    return test;
};

/** addRamp(spec) defines a step-wise ramp-up of the load in a given test defined by a pervious
addTest(spec) call. See RAMP_DEFAULTS for a list of the parameters that can be specified in the ramp
specification, spec. */
var addRamp = exports.addRamp = function(spec) {
    Utils.defaults(spec, RAMP_DEFAULTS);
    
    var rampStep = LoopUtils.funLoop(function() {
            SCHEDULER.schedule({
                fun: spec.test.fun,
                argGenerator: function() { return http.createClient(spec.test.spec.port, spec.test.spec.host) },
                rps: spec.rpsPerStep,
                concurrency: spec.clientsPerStep,
                monitored: false
            })}),
        ramp = {
            spec: spec,
            jobs: [],
            fun: rampStep
        };

    ramp.jobs = SCHEDULER.schedule({
        fun: rampStep,
        delay: spec.delay,
        duration: spec.timeLimit,
        rps: spec.numberOfSteps / spec.timeLimit,
        monitored: false
    });

    return ramp;
};

/** Start all tests were added via addTest(spec) and addRamp(spec). When all tests complete, callback
will be called. If stayAliveAfterDone is true, then the nodeload HTTP server will remain running.
Otherwise, the server will automatically terminate once the tests are finished. */
var startTests = exports.startTests = function(callback, stayAliveAfterDone) {
    TEST_MONITOR.start();
    SCHEDULER.startAll(testsComplete(callback, stayAliveAfterDone));
};

/** A convenience function equivalent to addTest() followed by startTests() */
var runTest = exports.runTest = function(spec, callback, stayAliveAfterDone) {
    var t = addTest(spec);
    startTests(callback, stayAliveAfterDone);
    return t;
};

/** Use traceableRequest instead of built-in node.js `http.Client.request()` when tracking the 'uniques'
statistic. It allows URLs to be properly tracked. */
var traceableRequest = exports.traceableRequest = function(client, method, path, headers, body) {
    headers = headers || {};
    body = body || '';
    headers['content-length'] = headers['content-length'] || body.length;

    var request = client.request(method, path, headers);
    request.headers = headers;
    request.path = path;
    request.body = body;
    request.write(body);

    return request;
};



// =================
// Private
// =================
/** Returns a callback function that should be called at the end of the load test. It calls the user
specified callback function and sets a timer for terminating the nodeload process if no new tests are
started by the user specified callback. */
function testsComplete(callback, stayAliveAfterDone) {
    return function() {
        TEST_MONITOR.stop();

        callback && callback();

        if (!stayAliveAfterDone && !SLAVE_CONFIG) {
            checkToExitProcess();
        }
    };
}

/** Wait 3 seconds and check if anyone has restarted SCHEDULER (i.e. more tests). End process if not. */
function checkToExitProcess() {
    setTimeout(function() {
        if (!SCHEDULER.running) {
            qputs('\nFinishing...');
            LOGS.close();
            HTTP_SERVER.stop();
            setTimeout(process.exit, 500);
        }
    }, 3000);
}