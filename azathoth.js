#!/usr/bin/env node
/*
 Copyright (c) 2010 Orlando Vazquez

 Permission is hereby granted, free of charge, to any person
 obtaining a copy of this software and associated documentation
 files (the "Software"), to deal in the Software without
 restriction, including without limitation the rights to use,
 copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following
 conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 OTHER DEALINGS IN THE SOFTWARE.
*/

var sys = require('sys'),
    http = require('http');

var options = require('./options');
options.process();

var url = options.get('url');
var method = options.get('method');
var host = options.get('host');
var port = options.get('port');
var numClients = options.get('numClients');
var numRequests = options.get('numRequests');
var path = options.get('path');
var reqPerClient = options.get('reqPerClient');
var requestGenerator = options.get('requestGenerator');

var elapsedStart;
var elapsedTime;
var totalTime = 0;
var bytesTransferred = 0;
var responseTimes = [];

function stats(v) {
    var l = v.length
    var mean = v.reduce(function (a, b) { return a + b }) / l;
    var s = 0;
    v.forEach(function (val) {
        s += Math.pow(val - mean, 2);
    });
    var variance = s / l;
    var deviation = Math.sqrt(variance);


    var percentile = function(percent) {
        var t = responseTimes[Math.floor(responseTimes.length*percent)];
        return t;
    };
    var min = responseTimes[0];
    var max = responseTimes[responseTimes.length-1];


    return {
        variance: variance,
        mean: mean,
        deviation: deviation,
        min: min,
        max: max,
        ninety: percentile(0.9), ninetyFive: percentile(0.95), ninetyNine: percentile(0.99)
    };
}

function pad(str, width) {
    return str + (new Array(width-str.length)).join(" ");
}

function printReportItem(name, val, padLength) {
    if (padLength == undefined)
        padLength = 40;
    sys.puts(pad(name + ":", padLength) + " " + val);
}

function printReport(report) {
    if (!options.get('quiet')) {
        sys.puts('');
    }
    printReportItem('Server Hostname', host);
    printReportItem('Server Port', port)

    if (requestGenerator == null) {
        printReportItem('HTTP Method', method)
        printReportItem('Document Path', path)
    } else {
        printReportItem('Request Generator', options.get('requestGeneratorModule'));
    }

    printReportItem('Concurrency Level', numClients);
    printReportItem('Number of requests', numRequests);
    printReportItem('Body bytes transferred', bytesTransferred);
    printReportItem('Elapsed time (s)', (elapsedTime/1000).toFixed(2));
    printReportItem('Time spent waiting on requests (s)', (totalTime/1000).toFixed(2));
    printReportItem('Requests per second', (report.stats.mean/elapsedTime).toFixed(2));
    printReportItem('Mean time per request (ms)', report.stats.mean.toFixed(2));
    printReportItem('Time per request standard deviation', report.stats.deviation.toFixed(2));
    
    sys.puts('');
    sys.puts('Percentages of requests served within a certain time (ms)');
    printReportItem("  Min", report.stats.min, 6);
    printReportItem("  90%", report.stats.ninety, 6);
    printReportItem("  95%", report.stats.ninetyFive, 6);
    printReportItem("  99%", report.stats.ninetyNine, 6);
    printReportItem("  Max", report.stats.max, 6);
}

function doClientRequests(clientIdCounter) {
    var j = 0;

    //sys.puts("Client " +clientIdCounter+  " reporting in!");
    
    var connection = http.createClient(port, host);
    function doRequest() {
        if (++j > numRequests/numClients) return;

        var start = (new Date()).getTime();
        var request;
        if (requestGenerator == null)
            request = connection.request(method, path, { 'host': host });
        else
            request = requestGenerator.getRequest();

        request.finish(function(response) {
            var end = (new Date()).getTime();
            var	delta = end - start;
            responseTimes.push(delta);
            totalTime += delta;
            var len = responseTimes.length;

            if (!options.get('quiet')) {
                if ((len % (numRequests/10)) == 0) {
                    sys.puts(pad('Completed ' +responseTimes.length+ ' requests', 40) + ' ('+ (len/numRequests*100) + '%)');
                }
            }

            if (len == numRequests) {
                elapsedTime = (new Date()) - elapsedStart;
                var s = stats(responseTimes);
                var report = {
                    stats: s
                };
                printReport(report);
                return;
            }

            response.addListener('body', function (body) {
                bytesTransferred += body.length;
            });
        });
        // Keep running doRequest until we hit target num requests or elapsed time.
        process.nextTick(arguments.callee);
    }

    process.nextTick(doRequest);
}

function main() {
    elapsedStart = new Date();
    for (var clientIdCounter = 0; clientIdCounter < numClients; clientIdCounter++) {
        doClientRequests(clientIdCounter);
    }
}

main();
