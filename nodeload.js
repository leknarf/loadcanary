#!/usr/bin/env node
/*
 Copyright (c) 2010 Benjamin Schmaus
 Copyright (c) 2010 Jonathan Lee 

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
var report = require('./report');
var stats = require('./stats');


options.process();

var url = options.get('url');
if (!url)
    options.help();

var method = options.get('method');
var host = options.get('host');
var port = options.get('port');
var numClients = options.get('numClients');
var numRequests = options.get('numRequests');
var timeLimit = options.get('timeLimit');
var path = options.get('path');
var requestData = options.get('requestData');
var requestGenerator = options.get('requestGenerator');
var quiet = options.get('quiet');
var reportInterval = options.get('reportInterval');
var requestsPerClient = numRequests/numClients;
var targetRps = options.get('targetRps');
var clientTimeout = (1 / (targetRps / numClients)) * 1000;

var bytesTransferred = 0;
var intervalStats = new stats.Histogram();
var cumulativeStats = new stats.Histogram();

// Keeps track of clients that are done working.  When all are finished
// results are generated.
var finishedClients = 0;

var reportId;

function initClientRequest(clientIdCounter) {
    var requestCounter = 0;
    var connection = http.createClient(port, host);

    function doRequest() {
        if (((timeLimit != null) && (new Date() - cumulativeStats.start) >= timeLimit) || 
                ((numRequests != null) && (++requestCounter > requestsPerClient))) {
            finishedClients++;
            finish();
            return;
        }
        
        var finished = false;
        var lagging = false;
        if (targetRps != null) {
            var rateLimitTimeoutId = setTimeout(function() { 
                if (!finished) {
                    lagging = true; 
                } else {
                    process.nextTick(doRequest); 
                }
            }, clientTimeout);
        } else {
            lagging = true;
        }

        var start = (new Date()).getTime();
        var request;
        if (requestGenerator == null) {
            request = connection.request(method, path, { 'host': host });

            if ((requestData != null) && (method.search('^(PUT|POST)$') != -1)) {
                request.sendBody(requestData);
            }
        } else {
            request = requestGenerator.getRequest(connection);
        }

        request.addListener('response', function(response) {
            var end = new Date();
            var	delta = end - start;
            cumulativeStats.put(delta);
            intervalStats.put(delta);
            finished = true;
            
            response.addListener('body', function(body) {
                bytesTransferred += body.length;
            });
            response.addListener('end', function(body) {
                // Tee up next request after this one finishes.
                if (lagging == true) {
                    process.nextTick(doRequest);
                }
            });
        });
        request.close();
    }

    process.nextTick(doRequest);
}

function finish() {
    // display results when the last client has finished.
    if (finishedClients == numClients) {
        clearInterval(reportId);
        
        var results = {
            bytesTransferred: bytesTransferred,
            stats: cumulativeStats
        };
        report.finish(results, options);
    }
}

var doReport = function() {
    report.progress({intervalStats: intervalStats, cumulativeStats: cumulativeStats});
    if (intervalStats.length > 0)
        intervalStats = new stats.Histogram();
}

function main() {

    if (quiet)
        report.setEcho(false);

    for (var clientIdCounter = 0; clientIdCounter < numClients; clientIdCounter++) {
        initClientRequest(clientIdCounter);
    }
    
    reportId = setInterval(doReport, reportInterval * 1000);
}

main();
