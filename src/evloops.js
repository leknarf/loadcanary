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

