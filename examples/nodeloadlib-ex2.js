#!/usr/bin/env node

// Self contained node.js HTTP server and a load test against it. Just run:
//
//     node examples/nodeloadlib-ex2.js
//
var http = require('http');
var sys = require('sys');
var nl = require('../lib/nodeloadlib');
sys.puts("Test server on localhost:9000.");
http.createServer(function (req, res) {
    res.writeHead((Math.random() < .8) ? 200 : 404, {'Content-Type': 'text/plain'});
    res.write('foo\n');
    res.end();
}).listen(9000);

var test = nl.addTest({
    name: "Read",
    host: 'localhost',
    port: 9000,
    numClients: 10,
    timeLimit: 600,
    targetRps: 500,
    successCodes: [200,404],
    reportInterval: 2,
    stats: ['result-codes', 'latency', 'concurrency', 'uniques'],
    latencyConf: {percentiles: [.90, .999]},
    requestGenerator: function(client) {
        return nl.traceableRequest(client, 'GET', "/" + Math.floor(Math.random()*8000), { 'host': 'localhost' });
    }
});

nl.startTests();
