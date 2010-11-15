// ------------------------------------
// Monitoring
// ------------------------------------
//
// This file defines Monitor and MonitorSet, and StatsLogger
//
//
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var START = new Date();
var util = require('./util');
var EventEmitter = require('events').EventEmitter;
var stats = require('./stats');
var Histogram = stats.Histogram;
var Peak = stats.Peak;
var ResultsCounter = stats.ResultsCounter;
var Uniques = stats.Uniques;
var Accumulator = stats.Accumulator;
var LogFile = stats.LogFile;
}

var UpdateEventGenerator, StatsLogger;

// -----------------
// Monitor
// -----------------
/** Monitor is used to track code statistics of code that is run multiple times or concurrently:

     var monitor = new Monitor('runtime');
     function f() {
         var m = monitor.start();
         doSomethingAsynchronous(..., function() {
             m.end();
         });
     }
     ...
     console.log('f() median runtime (ms): ' + monitor.stats['runtime'].percentile(.5));

Look at monitoring.test.js for more examples.

Monitor can also emits periodic 'update' events with overall and statistics since the last 'update'. This
allows the statistics to be introspected at regular intervals for things like logging and reporting.

@param arguments contain names of the statistics to track. Register more statistics by extending
                 Monitor.Monitors.
*/
var Monitor = exports.Monitor = function Monitor() { // arguments 
    EventEmitter.call(this);
    this.targets = [];
    this.setStats.apply(this, arguments);
    this.updater = new UpdateEventGenerator(this);
};

util.inherits(Monitor, EventEmitter);

/** Set the statistics this monitor should gather. */
Monitor.prototype.setStats = function(stats) { // arguments contains stats names
    var self = this;
    self.monitors = [];
    self.stats = {};
    self.interval = {};
    stats = (stats instanceof Array) ? stats : [].concat.apply([], arguments);
    stats.forEach(function(name) {
        if (!Monitor.Monitors[name]) { throw new Error('No monitor for statistic: ' + name); }
        var intervalmon = new Monitor.Monitors[name]();
        var overallmon = new Monitor.Monitors[name]();
        self.monitors.push(intervalmon);
        self.monitors.push(overallmon);
        self.interval[name] = intervalmon.stats;
        self.stats[name] = overallmon.stats;
    });
};

/** Monitor should gather statistics for each intervalMs period, and generate 'update' events */
Monitor.prototype.updateEvery = function(intervalMs) {
    this.updater.updateEvery(intervalMs);
    return this;
};

/** Stop generating 'update' events */
Monitor.prototype.disableUpdates = function() {
    return this.updateEvery(0);
};

/** Called by the instrumented code when it begins executing. Call .end() on the returned object
when complete. */
Monitor.prototype.start = function(args) {
    var self = this, 
        endFuns = [],
        doStart = function(m, context) {
            if (m.start) { m.start(context, args); }
            if (m.end) { 
                endFuns.push(function(result) { return m.end(context, result); }); 
            }
        };
    self.monitors.forEach(function(m) { doStart(m, {}); });
    return {
        end: function(result) {
            endFuns.forEach(function(f) { f(result); });
        }
    };
};

/** Monitor a set of EventEmitter objects, where each object is analogous to a thread. The objects
should emit 'start' and 'end' when they begin doing the operation being instrumented. This is useful
for monitoring concurrently executing instances of loop.js#Loop. */
Monitor.prototype.monitor = function(objs) {
    var self = this;
    objs = (objs instanceof Array) ? objs : [].concat.apply([], arguments);
    objs.forEach(function(o) {
        var mon;
        o.on('start', function(args) {
            mon = self.start(args);
        });
        o.on('end', function(result) {
            mon.end(result);
        });
    });
    return self;
};

/** Emit the 'update' event and reset the statistics for the next window */
Monitor.prototype.doUpdate = function() {
    this.emit('update', this.interval, this.stats);
    util.forEach(this.interval, function(name, stats) {
        if (stats.length > 0) {
            stats.clear();
        }
    });
};

/** Track the runtime of an operation, storing stats in a stats.js#Histogram  */
function RuntimeMonitor() {
    var self = this;
    self.stats = new Histogram();
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context) { self.stats.put(new Date() - context.start); };
}

/** Track HTTP response codes, storing stats in a stats.js#ResultsCounter object. The client must call 
.end({res: http.ClientResponse}). */
function ResultCodeMonitor() {
    var self = this;
    self.stats = new ResultsCounter();
    self.end = function(context, http) { self.stats.put(http.res.statusCode); };
}

/** Track the concurrent executions (ie. stuff between calls to .start() and .end()), storing in a 
stats.js#Peak. */
function ConcurrencyMonitor() {
    var self = this, c = 0;
    self.stats = new Peak();
    self.start = function() { c++; };
    self.end = function() { self.stats.put(c--); };
}

/** Track the size of HTTP request bodies sent by adding up the content-length headers. This function
doesn't really work as you'd hope right now, since it doesn't work for chunked encoding messages and 
doesn't return actual bytes over the wire (headers, etc). */
function RequestBytesMonitor() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) {
        if (http && http.req && http.req.headers && http.req.headers['content-length']) {
            self.stats.put(http.req.headers['content-length']);
        }
    };
}

/** Track the size of HTTP response bodies. It doesn't account for headers! */
function ResponseBytesMonitor() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) { 
        if (http && http.res) { 
            http.res.on('data', function(chunk) {
                self.stats.put(chunk.length);
            });
        }
    };
}

/** Track unique URLs requested, storing stats in a stats.js#Uniques object. The client must call 
Monitor.start({req: http.ClientRequest}). */
function UniquesMonitor() {
    var self = this;
    self.stats = new Uniques();
    self.end = function(context, http) { 
        if (http && http.req) { self.stats.put(http.req.path); }
    };
}

/** Define new statistics that Monitor can track by adding to Monitor.Monitors. Each entry should be a
class with: 
- stats, a member which implements the standard interface found in stats.js
- start(context, args), optional, called when execution of the instrumented code is about to start
- end(context, result), optional, called when the instrumented code finishes executing */
Monitor.Monitors = {
    'runtime': RuntimeMonitor,
    'latency': RuntimeMonitor,
    'result-codes': ResultCodeMonitor,
    'concurrency': ConcurrencyMonitor,
    'request-bytes': RequestBytesMonitor,
    'response-bytes': ResponseBytesMonitor,
    'uniques': UniquesMonitor,
};


// -----------------
// MonitorSet
// -----------------
/** MonitorSet represents a group of Monitor instances. Calling MonitorSet('runtime').start('myfunction')
is equivalent to creating a Monitor('runtime') for myfunction and and calling start(). MonitorSet can 
also emit regular 'update' events as well as log the statistics from the interval to disk.

@param arguments contain names of the statistics to track. Register more statistics by extending
                 Monitor.Monitors. */
var MonitorSet = exports.MonitorSet = function MonitorSet(statsNames) {
    EventEmitter.call(this);

    var summaryFun = function() {
        var summary = {};
        util.forEach(this, function(monitor, stats) {
            if (monitor === 'summary') { return; }
            summary[monitor] = {};
            util.forEach(stats, function(name, stat) {
                summary[monitor][name] = stat.summary();
            });
        });
        return summary;
    };
    this.statsNames = (statsNames instanceof Array) ? statsNames : [].concat.apply([], arguments);
    this.monitors = {};
    this.updater = new UpdateEventGenerator(this);
    this.stats = { summary: summaryFun };
    this.interval = { summary: summaryFun };
};

util.inherits(MonitorSet, EventEmitter);

/** Pre-initialize monitors with the given names. This allows construction overhead to take place all at 
once if desired. */
MonitorSet.prototype.init = function(monitorNames) { // arguments contains monitor names
    var self = this;
    monitorNames = (monitorNames instanceof Array) ? monitorNames : [].concat.apply([], arguments);
    monitorNames.forEach(function(name) { 
        self.monitors[name] = new Monitor(self.statsNames);
        self.stats[name] = self.monitors[name].stats;
        self.interval[name] = self.monitors[name].interval;
    });
    return self;
};

/** All the Monitors in this set should gather statistics for each intervalMs period. MonitorSet should 
generate 'update' events */
MonitorSet.prototype.updateEvery = function(intervalMs) {
    this.updater.updateEvery(intervalMs);
    return this;
};

MonitorSet.prototype.disableUpdates = function() {
    return this.updateEvery(0);
};

/** Call .start() for the named monitor */
MonitorSet.prototype.start = function(monitor, args) {
    monitor = monitor || '';
    if (!this.monitors[monitor]) {
        this.init([monitor]);
    }
    return this.monitors[monitor].start(args);
};

/** Like Monitor.monitor() except each object's 'start' event should include the monitor name as its
first argument. See monitoring.test.js for an example. */
MonitorSet.prototype.monitor = function(objs) {
    var self = this, mons = {};
    objs = (objs instanceof Array) ? objs : [].concat.apply([], arguments);
    objs.forEach(function(o) {
        o.on('start', function(monitor, args) {
            mons[monitor] = self.start(monitor, args);
        });
        o.on('end', function(monitor, result) {
            if (mons[monitor]) { mons[monitor].end(result); }
        });
    });
    return self;
};

/** Log statistics to the given file or stats.js#LogFile object each time an 'update' event is emitted */
MonitorSet.prototype.startLogger = function(logNameOrObject) {
    if (this.logger) { return; }
    this.logger = new StatsLogger(this, logNameOrObject).start();
    return this;
};

MonitorSet.prototype.stopLogger = function() {
    if (!this.logger) { return; }
    this.logger.stop();
    this.logger = null;
    return this;
};

/** Emit the update event and reset the statistics for the next window */
MonitorSet.prototype.doUpdate = function() {
    this.emit('update', this.interval, this.stats);
    util.forEach(this.monitors, function (name, m) { m.doUpdate(); });
};


// -----------------
// StatsLogger
// -----------------
/** StatsLogger writes interval stats from a Monitor or MonitorSet to disk each time it emits 'update' */
var StatsLogger = exports.StatsLogger = function StatsLogger(monitor, logNameOrObject) {
    logNameOrObject = logNameOrObject || ('results-' + START.getTime() + '-stats.log');
    this.log = (typeof logNameOrObject === 'string') ? new LogFile(logNameOrObject) : logNameOrObject;
    this.monitor = monitor;
    this.logger_ = this.log_.bind(this);
};
StatsLogger.prototype.start = function() {
    this.monitor.on('update', this.logger_);
    this.log.put('[');
    return this;
};
StatsLogger.prototype.stop = function() {
    this.log.put(']');
    this.monitor.removeListener('update', this.logger_);
    return this;
};
StatsLogger.prototype.log_ = function(interval) {
    this.log.put(JSON.stringify(interval.summary()) + ',\n');
};

// =================
// Private methods
// =================
function UpdateEventGenerator(parent) {
    this.parent = parent;
}
UpdateEventGenerator.prototype.updateEvery = function(intervalMs) {
    clearTimeout(this.updateTimeoutId);
    this.scheduleUpdate_(intervalMs);
};
UpdateEventGenerator.prototype.scheduleUpdate_ = function(intervalMs) {
    var self = this;
    if (intervalMs > 0) {
        self.updateTimeoutId = setTimeout(
            function() { 
                self.scheduleUpdate_(intervalMs);
                self.parent.doUpdate();
            }, 
            intervalMs);
    }
};