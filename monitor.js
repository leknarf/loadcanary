var sys = require('sys');
var stats = require('./stats');

function monitorLatencies(latencies, fun) {
    return function(loopFun, client) {
        var start = new Date();
        var finish = function(response) {
            if (response == null) {
                sys.puts('HTTP response is null; did you forget to call loopFun(response)?');
            } else {
                latencies.put(new Date() - start);
            }
            loopFun(response, client);
        }
        fun(finish, client);
    }
}
function monitorResponseCodes(responseCodes, fun) {
    return function(loopFun, client) {
        var finish = function(response) {
            if (response == null) {
                sys.puts('HTTP response is null; did you forget to call loopFun(response)?');
            } else {
                responseCodes.put(response.statusCode);
            }
            loopFun(response, client);
        }
        fun(finish, client);
    }
}

function monitorByteReceived(bytesReceived, fun) {
    return function(loopFun, client) {
        var finish = function(response) {
            if (response == null) {
                sys.puts('HTTP response is null; did you forget to call loopFun(response)?');
            } else {
                bytesReceived.put(body.length);
            }
            loopFun(response, client);
        }
        fun(finish, client);
    }
}

function monitorConcurrency(concurrency, fun) {
    var c = 0;
    return function(loopFun, client) {
        c++;
        var finish = function(response) {
            if (response == null) {
                sys.puts('HTTP response is null; did you forget to call loopFun(response)?');
            } else {
                concurrency.put(c);
                c--;
            }
            loopFun(response, client);
        }
        fun(finish, client);
    }
}

function defaultProgressFun(stats) {
    var out = '{"ts": "' + JSON.stringify(new Date()) + '"';
    for (i in stats) {
        out += ', "s' + i + '": {'
        if (stats[i].interval.length > 0) {
            out += stats[i].interval.summary();
        }
        out += "}";
    }
    out += "}";
    sys.puts(out);
}

function progressReport(stats, progressFun) {
    if (progressFun == null)
        progressFun = defaultProgressFun;
    if (stats.length == null || stats.length == 0)
        stats = [stats];

    return function(loopFun) {
        progressFun(stats);
        for (i in stats) {
            stats[i].next();
        }
        loopFun();
    }
}

exports.monitorLatencies = monitorLatencies;
exports.monitorResponseCodes = monitorResponseCodes;
exports.monitorByteReceived = monitorByteReceived;
exports.monitorConcurrency = monitorConcurrency;
exports.progressReport = progressReport;