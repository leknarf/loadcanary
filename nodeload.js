#!/usr/bin/env node
/*
 Copyright (c) 2010 Orlando Vazquez, Benjamin Schmaus

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
var reqPerClient = options.get('reqPerClient');
var requestGenerator = options.get('requestGenerator');

var elapsedStart;
var elapsedTime;
var bytesTransferred = 0;
var responseTimes = [];

// Keeps track of clients that are done working.  When all are finished
// results are generated.
var finishedClients = 0;

function initClientRequest(clientIdCounter) {
    var requestCounter = 0;

    //sys.puts("Client " +clientIdCounter+  " reporting in!");
    var connection = http.createClient(port, host);

    function doRequest() {
        var done = false;
        if ((timeLimit != null) && (new Date() - elapsedStart) >= timeLimit) {
            finishedClients++;
            done = true;
            //sys.debug("times up! " + finishedClients);
        }
        if ((numRequests != null) && (++requestCounter > numRequests/numClients)) {
            finishedClients++;
            done = true;
            //sys.debug("requests up! " + finishedClients);
        }
        if (done) {
            doResults();
            return;
        }
        var request;
        if (requestGenerator == null) {
            request = connection.request(method, path, { 'host': host });
        } else {
            request = requestGenerator.getRequest(connection);
        }
        var start = (new Date()).getTime();

        if ((options.get('requestData') != null) && (method.search('^(PUT|POST)$') != -1)) {
            //sys.puts("data is " + options.get('requestData'));
            request.sendBody(
                options.get('requestData')
            );
        }

        request.finish(function(response) {
            var end = (new Date()).getTime();
            var	delta = end - start;
            responseTimes.push(delta);
            var len = responseTimes.length;

            if (!options.get('quiet')) {
                report.progress(len, numRequests);
            }

            response.addListener('body', function(body) {
                bytesTransferred += body.length;
                // Tee up next request after this one finishes.
                process.nextTick(doRequest);
            });
        });
    }

    process.nextTick(doRequest);
}

function doResults() {
    // display results when the last client has finished.
    if (finishedClients == numClients) {
        elapsedTime = (new Date()) - elapsedStart;
        var results = {
            bytesTransferred: bytesTransferred,
            elapsedTime: elapsedTime,
            responseTimes: responseTimes
        };
        report.print(results, options);
    }
}

function main() {
    elapsedStart = new Date();
    for (var clientIdCounter = 0; clientIdCounter < numClients; clientIdCounter++) {
        initClientRequest(clientIdCounter);
    }
}

main();
