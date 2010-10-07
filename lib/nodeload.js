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

var options = require('./options');
options.process();

if (!options.get('url'))
    options.help();

var nl = require('../lib/nodeloadlib')
            .quiet()
            .setMonitorIntervalMs(options.get('reportInterval') * 1000);

function puts(text) { if (!options.get('quiet')) console.log(text) }
function pad(str, width) { return str + (new Array(width-str.length)).join(" "); }
function printItem(name, val, padLength) {
    if (padLength == undefined) padLength = 40;
    puts(pad(name + ":", padLength) + " " + val);
}

nl.TEST_MONITOR.on('start', function(tests) { testStart = new Date(); });
nl.TEST_MONITOR.on('update', function(tests) {
    puts(pad('Completed ' +tests[0].stats['result-codes'].cumulative.length+ ' requests', 40));
});
nl.TEST_MONITOR.on('end', function(tests) {

    var stats = tests[0].stats;
    var elapsedSeconds = ((new Date()) - testStart)/1000;

    puts('');
    printItem('Server', options.get('host') + ":" + options.get('port'));

    if (options.get('requestGeneratorModule') == null) {
        printItem('HTTP Method', options.get('method'))
        printItem('Document Path', options.get('path'))
    } else {
        printItem('Request Generator', options.get('requestGeneratorModule'));
    }

    printItem('Concurrency Level', options.get('numClients'));
    printItem('Number of requests', stats['result-codes'].cumulative.length);
    printItem('Body bytes transferred', stats['request-bytes'].cumulative.total + stats['response-bytes'].cumulative.total);
    printItem('Elapsed time (s)', elapsedSeconds.toFixed(2));
    printItem('Requests per second', (stats['result-codes'].cumulative.length/elapsedSeconds).toFixed(2));
    printItem('Mean time per request (ms)', stats['latency'].cumulative.mean().toFixed(2));
    printItem('Time per request standard deviation', stats['latency'].cumulative.stddev().toFixed(2));
    
    puts('\nPercentages of requests served within a certain time (ms)');
    printItem("  Min", stats['latency'].cumulative.min, 6);
    printItem("  Avg", stats['latency'].cumulative.mean().toFixed(1), 6);
    printItem("  50%", stats['latency'].cumulative.percentile(.5), 6)
    printItem("  95%", stats['latency'].cumulative.percentile(.95), 6)
    printItem("  99%", stats['latency'].cumulative.percentile(.99), 6)
    printItem("  Max", stats['latency'].cumulative.max, 6);
});

nl.runTest({
    name: 'nodeload',
    host: options.get('host'),
    port: options.get('port'),
    requestGenerator: options.get('requestGenerator'),
    method: options.get('method'),
    path: options.get('path'),
    requestData: options.get('requestData'),
    numClients: options.get('numClients'),
    numRequests: options.get('numRequests'),
    timeLimit: options.get('timeLimit'),
    targetRps: options.get('targetRps'),
    stats: ['latency', 'result-codes', 'bytes']
});
