//
// Define new statistics that Monitor can track by adding to this file. Each class should have:
//
// - stats, a member which implements the standard interface found in stats.js
// - start(context, args), optional, called when execution of the instrumented code is about to start
// - end(context, result), optional, called when the instrumented code finishes executing 
//
// Defining .disableIntervalCollection and .disableCumulativeCollection to the collection of per-interval
// and overall statistics respectively.
// 

/*jslint sub:true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var stats = require('./stats');
var Histogram = stats.Histogram;
var Peak = stats.Peak;
var ResultsCounter = stats.ResultsCounter;
var Uniques = stats.Uniques;
var Accumulator = stats.Accumulator;
var LogFile = stats.LogFile;
var StatsCollectors = exports;
} else {
var StatsCollectors = {};
}

/** Track the runtime of an operation, storing stats in a stats.js#Histogram  */
StatsCollectors['runtime'] = StatsCollectors['latency'] = function RuntimeCollector(params) {
    var self = this;
    self.stats = new Histogram(params);
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context) { self.stats.put(new Date() - context.start); };
};

/** Track HTTP response codes, storing stats in a stats.js#ResultsCounter object. The client must call 
.end({res: http.ClientResponse}). */
StatsCollectors['result-codes'] = function ResultCodesCollector() {
    var self = this;
    self.stats = new ResultsCounter();
    self.end = function(context, http) { self.stats.put(http.res.statusCode); };
};

/** Track the concurrent executions (ie. stuff between calls to .start() and .end()), storing in a 
stats.js#Peak. */
StatsCollectors['concurrency'] = function ConcurrencyCollector() {
    var self = this, c = 0;
    self.stats = new Peak();
    self.start = function() { c++; };
    self.end = function() { self.stats.put(c--); };
};

/** Track the size of HTTP request bodies sent by adding up the content-length headers. This function
doesn't really work as you'd hope right now, since it doesn't work for chunked encoding messages and 
doesn't return actual bytes over the wire (headers, etc). */
StatsCollectors['request-bytes'] = function RequestBytesCollector() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) {
        if (http && http.req) {
            if (http.req._header) { self.stats.put(http.req._header.length); }
            if (http.req.body) { self.stats.put(http.req.body.length); }
        }
    };
};

/** Track the size of HTTP response bodies. It doesn't account for headers! */
StatsCollectors['response-bytes'] = function ResponseBytesCollector() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) { 
        if (http && http.res) { 
            http.res.on('data', function(chunk) {
                self.stats.put(chunk.length);
            });
        }
    };
};

/** Track unique URLs requested, storing stats in a stats.js#Uniques object. The client must call 
Monitor.start({req: http.ClientRequest}). */
StatsCollectors['uniques'] = function UniquesCollector() {
    var self = this;
    self.stats = new Uniques();
    self.end = function(context, http) { 
        if (http && http.req) { self.stats.put(http.req.path); }
    };
};
StatsCollectors['uniques'].disableIntervalCollection = true; // Per-interval stats should be not be collected

StatsCollectors['http-errors'] = function HttpErrorsCollector(params) {
    var self = this;
    self.stats = new Accumulator();
    self.successCodes = params.successCodes || [200];
    self.logfile = (typeof params.log === 'string') ? new LogFile(params.log) : params.log; 
    self.end = function(context, http) {
        if (self.successCodes.indexOf(http.res.statusCode) < 0) {
            self.stats.put(1);

            if (self.logfile) {
                var body = '';
                http.res.on('data', function(chunk) { body += chunk; });
                http.res.on('end', function(chunk) {
                    self.logfile.put(JSON.stringify({
                        ts: new Date(), 
                        req: {
                            // Use the _header "private" member of http.ClientRequest, available as of 
                            // node v0.2.2 (9/30/10). This is the only way to reliably get all request
                            // headers, since ClientRequest adds headers beyond what the user specifies
                            // in certain conditions, like Connection and Transfer-Encoding. 
                            headers: http.req._header,
                            body: http.req.body,
                        },
                        res: {
                            statusCode: http.res.statusCode, 
                            headers: http.res.headers, 
                            body: body
                        }
                    }) + '\n');
                });
            }
        }
    };
};
StatsCollectors['http-errors'].disableIntervalCollection = true; // Per-interval stats should be not be collected
