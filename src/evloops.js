// -----------------------------------------
// Event-based looping
// -----------------------------------------
// 
// This file defines ConditionalLoop, LoopConditions, and LoopUtils.
// 
// Nodeload uses the node.js event loop to schedule iterations of a particular function. In order for
// this to work, the function must cooperate by accepting a loopFun as its first argument and call 
// loopFun() when it completes each iteration. This is refered to as "event-based looping" in nodeload.
// 
// This file defines the generic ConditionalLoop class for looping on an arbitrary function, and a number
// of other event based loops for predefined tasks, such as tracking the latency of the loop body.
// 

/** ConditionalLoop wraps an arbitrary function to be executed in a loop. Each iteration of the loop is
scheduled in the node.js event loop using process.nextTick(), which allows other events in the loop to be
handled as the loop executes.

@param fun          a function:
                    
                        function(loopFun, args) {
                            ...
                            loopFun(result);
                        }
                    
                    that calls loopFun(result) when it finishes. Use LoopUtils.funLoop() to wrap a
                    function for use in a ConditionalLoop.
@param args         passed as-is as the second argument to fun
@param conditions   a list of functions that are called at the beginning of every loop. If any 
                    function returns false, the loop terminates. See LoopConditions.
@param delay        number of seconds before the first iteration of fun is executed */
var ConditionalLoop = exports.ConditionalLoop = function(fun, args, conditions, delay) {
    this.fun = fun;
    this.args = args;
    this.conditions = conditions || [];
    this.delay = delay;
    this.stopped = true;
    this.callback = null;
}
ConditionalLoop.prototype = {
    /** Start executing "ConditionalLoop.fun" with the arguments, "ConditionalLoop.args", until any
    condition in "ConditionalLoop.conditions" returns false. The loop begins after a delay of
    "ConditionalLoop.delay" seconds. When the loop completes, the user defined function, callback is
    called. */
    start: function(callback) {
        this.callback = callback;
        this.stopped = false;
        if (this.delay && this.delay > 0) {
            var loop = this;
            setTimeout(function() { loop.loop_() }, this.delay * 1000);
        } else {
            this.loop_();
        }
    },
    stop: function() {
        this.stopped = true;
    },
    /** Calls each function in ConditionalLoop.conditions. Returns false if any function returns false */
    checkConditions_: function() {
        return !this.stopped && this.conditions.every(function(c) { return c(); });
    },
    /** Checks conditions and schedules the next loop iteration */
    loop_: function() {
        if (this.checkConditions_()) {
            var loop = this;
            process.nextTick(function() { loop.fun(function() { loop.loop_() }, loop.args) });
        } else {
            this.callback && this.callback();
        }
    }
}


/** LoopConditions contains predefined functions that can be used in ConditionalLoop.conditions */
var LoopConditions = exports.LoopConditions = {
    /** Returns false after a given number of seconds */
    timeLimit: function(seconds) {
        var start = new Date();
        return function() { 
            return (seconds === Infinity) || ((new Date() - start) < (seconds * 1000));
        };
    },
    /** Returns false after a given number of iterations */
    maxExecutions: function(numberOfTimes) {
        var counter = 0;
        return function() { 
            return (numberOfTimes === Infinity) || (counter++ < numberOfTimes)
        };
    }
};


/** LoopUtils contains helpers for dealing with ConditionalLoop loop functions */
var LoopUtils = exports.LoopUtils = {
    /** A wrapper for any existing function so it can be used by ConditionalLoop. e.g.:
            myfun = function(x) { return x+1; }
            new ConditionalLoop(LoopUtils.funLoop(myfun), args, [LoopConditions.timeLimit(10)], 0) */
    funLoop: function(fun) {
        return function(loopFun, args) {
            loopFun(fun(args));
        }
    },
    /** Wrap a loop function. For each iteration, calls startRes = start(args) before calling fun(), and
    calls finish(result-from-fun, startRes) when fun() finishes. */
    loopWrapper: function(fun, start, finish) {
        return function(loopFun, args) {
            var startRes = start && start(args),
                finishFun = function(result) {
                    if (result === undefined) {
                        qputs('Function result is null; did you forget to call loopFun(result)?');
                    }

                    finish && finish(result, startRes);
                    
                    loopFun(result);
                }
            fun(finishFun, args);
        }
    },
    /** Wrapper for executing a ConditionalLoop function rps times per second. */
    rpsLoop: function(rps, fun) {
        var timeout = 1/rps * 1000,
            finished = false,
            lagging = false,
            finishFun = function(loopFun) {
                finished = true;
                if (lagging) {
                    loopFun(); 
                }
            };

        return function(loopFun, args) {
            finished = false;
            lagging = (timeout <= 0);
            if (!lagging) {
                setTimeout(function() { 
                    lagging = !finished;
                    if (!lagging) {
                        loopFun();
                    }
                }, timeout);
            }
            fun(function() { finishFun(loopFun) }, args);
        }
    },
    /** Wrapper for request generator function, "generator"
    
    @param generator A function:
    
                         function(http.Client) -> http.ClientRequest
    
                     The http.Client is provided by nodeload. The http.ClientRequest may contain an extra
                     .timeout field specifying the maximum milliseconds to wait for a response.
    
    @return A ConditionalLoop function, function(loopFun, http.Client). Each iteration makes an HTTP
            request by calling generator. loopFun({req: http.ClientRequest, res: http.ClientResponse}) is
            called when the HTTP response is received or the request times out. */
    requestGeneratorLoop: function(generator) {
        return function(loopFun, client) {
            var request = generator(client),
                timedOut = false,
                timeoutId = null;

            if (!request) {
                qputs('WARN: HTTP request is null; did you forget to call return request?');
                loopfun(null);
            } else {
                if (request.timeout > 0) {
                    timeoutId = setTimeout(function() {
                        timedOut = true;
                        loopFun({req: request, res: {statusCode: 0}});
                    }, request.timeout);
                }
                request.on('response', function(response) {
                    if (!timedOut) {
                        if (timeoutId !== null) {
                            clearTimeout(timeoutId);
                        }
                        loopFun({req: request, res: response});
                    }
                });
                request.end();
            }
        }
    },

    // ------------------------------------
    // Monitoring loops
    // ------------------------------------
    /** Time each call to fun and write the runtime information to latencies, which is generally a 
        stats.js#Histogram object. */
    monitorLatenciesLoop: function(latencies, fun) {
        var start = function() { return new Date() }
        var finish = function(result, start) { latencies.put(new Date() - start) };
        return LoopUtils.loopWrapper(fun, start, finish);
    },
    /** Each call to fun should return an object {res: http.ClientResponse}. This function tracks the http
        response codes and writes them to results, which is generally a stats.js#ResultsCounter object. */
    monitorResultsLoop: function(results, fun) {
        var finish = function(http) { results.put(http.res.statusCode) };
        return LoopUtils.loopWrapper(fun, null, finish);
    },
    /** Each call to fun should return an object {res: http.ClientResponse}. This function reads the http
        response body and writes its size to bytesReceived, which is generally a stats.js#Accumlator object. */
    monitorByteReceivedLoop: function(bytesReceived, fun) {
        var finish = function(http) { 
            http.res.on('data', function(chunk) {
                bytesReceived.put(chunk.length);
            });
        };
        return LoopUtils.loopWrapper(fun, null, finish);
    },
    /** Each call to fun should return an object {res: http.ClientResponse}. This function reads the http
        response body and writes its size to bytesSent, which is generally a stats.js#Accumlator object. */
    monitorByteSentLoop: function(bytesSent, fun) {
        var finish = function(http) {
            if (http.req.headers && http.req.headers['content-length']) {
                bytesSent.put(http.req.headers['content-length']);
            }
        };
        return LoopUtils.loopWrapper(fun, null, finish);
    },
    /** Tracks the concurrency of calls to fun and writes it to concurrency, which is generally a
        stats.js#Peak object. */
    monitorConcurrencyLoop: function(concurrency, fun) {
        var c = 0;
        var start = function() { c++; };
        var finish = function() { concurrency.put(c--) };
        return LoopUtils.loopWrapper(fun, start, finish);
    },
    /** Tracks the rate of calls to fun and writes it to rate, which is generally a stats.js#Rate object. */
    monitorRateLoop: function(rate, fun) {
        var finish = function() { rate.put() };
        return LoopUtils.loopWrapper(fun, null, finish);
    },
    /** Each call to fun should return an object {res: http.ClientResponse}. This function reads the http
        response code and writes the full request and response to "log" if the response code is not in the 
        "successCodes" list. "log" is generally a stats.js#LogFile object. */
    monitorHttpFailuresLoop: function(successCodes, fun, log) {
        log = log || LOGS.ERROR_LOG;
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
                            // Use the _header "private" member of http.ClientRequest, which is available 
                            // in the current node release (v0.2.2, 9/30/10). This is the only way to 
                            // reliably get all of the request headers, since ClientRequest will actually
                            // add headers beyond what the user specifies in certain conditions, like
                            // Connection and Transfer-Encoding. 
                            headers: http.req._header,
                            body: http.req.body,
                        },
                        res: {
                            statusCode: http.res.statusCode, 
                            headers: http.res.headers, 
                            body: body
                        }
                    }) + '\n');
                });
            }
        };
        return LoopUtils.loopWrapper(fun, null, finish);
    },
    /** Each call to fun should return an object {req: http.ClientRequest}. This function writes the request
        URL to uniqs which is generally a stats.js#Uniques object. */
    monitorUniqueUrlsLoop: function(uniqs, fun) {
        var finish = function(http) { uniqs.put(http.req.path) };
        return LoopUtils.loopWrapper(fun, null, finish);
    }
}