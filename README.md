NODELOAD
================

`nodeload` is both a **standalone tool** and a **`node.js` library** for load testing HTTP services.

See [NODELOADLIB.md](http://github.com/benschmaus/nodeload/blob/master/NODELOADLIB.md) for using `nodeload` as a `node.js` library.

See [NODELOAD.md](http://github.com/benschmaus/nodeload/blob/master/NODELOAD.md) for instructions on using the standalone load test tool.



NODELOAD QUICKSTART
================

1. Install node.js.
2. Clone nodeload.
3. cd into nodeload working copy.
4. git submodule update --init
5. Start testing!

nodeload contains a toy server that you can use for a quick demo.
Try the following:

	[~/code/nodeload] node examples/test-server.js &
	[1] 2756
	[~/code/nodeload] Server running at http://127.0.0.1:8000/
	[~/code/nodeload] ./dist/nodeload.js -f -c 10 -n 10000 -i 1 -r ./examples/test-generator.js localhost:8000

You should now see some test output in your console.  The generated webpage contains a graphical chart of test results.



NODELOADLIB QUICKSTART
================

Add `require('./dist/nodeloadlib')` and call `runTest()` or `addTest()/startTests()`:

    // Add to example.js:
    require('./dist/nodeloadlib');

    runTest({
        name: "Read",
        host: 'localhost',
        port: 8080,
        numClients: 20,
        timeLimit: 600,
        successCodes: [200],
        targetRps: 200,
        requestGenerator: function(client) {
            var url = '/data/object-' + Math.floor(Math.random()*10000);
            return traceableRequest(client, 'GET', url, { 'host': 'localhost' });
        }
    });
    
This test will hit localhost:8080 with 20 concurrent connections for 10 minutes.

    $ node examples/nodeloadlib-ex2.js         ## while running, browse to http://localhost:8000 to track the test
    Opening log files.
    Serving progress report on port 8000.
    Test server on localhost:9000.
    ......done.

    Finishing...
    Closed log files.
    Shutdown report server.

Browse to http://localhost:8000 during the test for graphs. Non-200 responses are logged to `results-{timestamp}-err.log`, `results-{timestamp}-stats.log` contains statistics, and the summary web page is written to `results-{timestamp}-summary.html`.

Check out [examples/nodeloadlib-ex.js](http://github.com/benschmaus/nodeload/blob/master/examples/nodeloadlib-ex.js) for a example of a full read+write test.
