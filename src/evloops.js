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
            var timedOut = false;
            var timeoutId = null;
            var id = uid();
            if (request.timeout != null) {
                timeoutId = setTimeout(function() {
                    timedOut = true;
                    loopFun({req: request, res: {statusCode: 0}});
                }, request.timeout);
            }
            request.addListener('response', function(response) {
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
monitorLatenciesLoop = function(latencies, fun) {
    var start = function() { return new Date() }
    var finish = function(result, start) { latencies.put(new Date() - start) };
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