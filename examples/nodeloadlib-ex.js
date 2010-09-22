#!/usr/bin/env node

// Instructions:
// 
// 1. Get node (http://nodejs.org/#download)
// 2. git clone http://github.com/benschmaus/nodeload.git
// 3. node nodeload/examples/nodeloadlib-ex.js
//
// This example performs a micro-benchmark of Riak (http://riak.basho.com/), a key-value store,
// running on localhost:8098/riak. First, it first loads 2000 objects into the store as quickly
// as possible. Then, it performs a 90% read + 10% update test at total request rate of 300 rps.
// From minutes 5-8, the read load is increased by 100 rps. The test runs for 10 minutes.

var sys = require('sys');
require('../dist/nodeloadlib');

function riakUpdate(loopFun, client, url, body) {
    var req = traceableRequest(client, 'GET', url, { 'host': 'localhost' });
    req.addListener('response', function(response) {
        if (response.statusCode != 200 && response.statusCode != 404) {
            loopFun({req: req, res: response});
        } else {
            var headers = { 
                'host': 'localhost', 
                'content-type': 'text/plain', 
                'x-riak-client-id': 'bmxpYg=='
                };
            if (response.headers['x-riak-vclock'] != null)
                headers['x-riak-vclock'] = response.headers['x-riak-vclock'];
                
            req = traceableRequest(client, 'PUT', url, headers, body);
            req.addListener('response', function(response) {
                loopFun({req: req, res: response});
            });
            req.end();
        }
    });
    req.end();
}

var i=0;
runTest({
    name: "Load Data",
    host: 'localhost',
    port: 8098,
    numClients: 20,
    numRequests: 2000,
    timeLimit: Infinity,
    successCodes: [204],
    reportInterval: 2,
    stats: ['result-codes', 'latency', 'concurrency', 'uniques'],
    requestLoop: function(loopFun, client) {
        riakUpdate(loopFun, client, '/riak/b/o' + i++, 'original value');
    }
}, startRWTest);

function startRWTest() {
    process.stdout.write("Running read + update test.");
    
    var reads = addTest({
        name: "Read",
        host: 'localhost',
        port: 8098,
        numClients: 30,
        timeLimit: 600,
        targetRps: 270,
        successCodes: [200,404],
        reportInterval: 2,
        stats: ['result-codes', 'latency', 'concurrency', 'uniques'],
        requestGenerator: function(client) {
            var url = '/riak/b/o' + Math.floor(Math.random()*8000);
            return traceableRequest(client, 'GET', url, { 'host': 'localhost' });
        }
    });
    var writes = addTest({
        name: "Write",
        host: 'localhost',
        port: 8098,
        numClients: 5,
        timeLimit: 600,
        targetRps: 30,
        successCodes: [204],
        reportInterval: 2,
        stats: ['result-codes', 'latency', 'concurrency', 'uniques'],
        requestLoop: function(loopFun, client) {
            var url = '/riak/b/o' + Math.floor(Math.random()*8000);
            riakUpdate(loopFun, client, url, 'updated value');
        }
    });
    
    // From minute 5, schedule 10x 10 read requests per second in 3 minutes = adding 100 requests/sec
    addRamp({
        test: reads,
        numberOfSteps: 10,
        rpsPerStep: 10,
        clientsPerStep: 2,
        timeLimit: 180,
        delay: 300
    });
    
    startTests();
}
