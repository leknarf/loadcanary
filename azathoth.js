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
var path = options.get('path');
var reqPerClient = options.get('reqPerClient');
var requestGenerator = options.get('requestGenerator');

var elapsedStart;
var elapsedTime;
var bytesTransferred = 0;
var responseTimes = [];

function doClientRequests(clientIdCounter) {
    var j = 0;

    //sys.puts("Client " +clientIdCounter+  " reporting in!");
    var connection = http.createClient(port, host);
    function doRequest() {
        if (++j > numRequests/numClients) return;

        var request;
        if (requestGenerator == null) {
            request = connection.request(method, path, { 'host': host });
        } else {
            request = requestGenerator.getRequest(connection);
        }
        var start = (new Date()).getTime();

        request.finish(function(response) {
            var end = (new Date()).getTime();
            var	delta = end - start;
            responseTimes.push(delta);
            var len = responseTimes.length;

            if (!options.get('quiet')) {
                if ((len % (numRequests/10)) == 0) {
                    sys.puts(report.pad('Completed ' +responseTimes.length+ ' requests', 40) + ' ('+ (len/numRequests*100) + '%)');
                }
            }

            response.addListener('body', function(body) {
                bytesTransferred += body.length;
                // display results after we count the body of the last request
                if (len == numRequests) {
                    elapsedTime = (new Date()) - elapsedStart;
                    var results = {
                        bytesTransferred: bytesTransferred,
                        elapsedTime: elapsedTime,
                        responseTimes: responseTimes
                    };
                    report.print(results, options);
                }
                // Tee up next request after this one finishes.
                process.nextTick(doRequest);
            });
        });
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
