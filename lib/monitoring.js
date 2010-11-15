// ------------------------------------
// Monitoring
// ------------------------------------
//
// This file defines Monitor and MonitorGroup, and StatsLogger
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
                 Monitor.StatsCollectors.
*/
var Monitor = exports.Monitor = function Monitor() { // arguments 
    EventEmitter.call(this);
    this.targets = [];
    this.setStats.apply(this, arguments);
    this.updater = new UpdateEventGenerator(this);
};

util.inherits(Monitor, EventEmitter);

/** Set the statistics this monitor should gather. */
Monitor.prototype.setStats = function(statsNames) { // arguments contains stats names
    var self = this;
    self.collectors = [];
    self.stats = {};
    self.interval = {};
    statsNames = (statsNames instanceof Array) ? statsNames : [].concat.apply([], arguments);
    statsNames.forEach(function(name) {
        if (!Monitor.StatsCollectors[name]) { throw new Error('No collector for statistic: ' + name); }
        var intervalCollector = new Monitor.StatsCollectors[name]();
        var overallCollector = new Monitor.StatsCollectors[name]();
        self.collectors.push(intervalCollector);
        self.collectors.push(overallCollector);
        self.interval[name] = intervalCollector.stats;
        self.stats[name] = overallCollector.stats;
    });
};

/** Monitor should gather statistics for each intervalMs period, and generate 'update' events */
Monitor.prototype.setUpdateIntervalMs = function(milliseconds) {
    this.updater.setUpdateIntervalMs(milliseconds);
    return this;
};

/** Called by the instrumented code when it begins executing. Returns a monitoring context. Call 
context.end() when the instrumented code completes. */
Monitor.prototype.start = function(args) {
    var self = this, 
        endFuns = [],
        doStart = function(m, context) {
            if (m.start) { m.start(context, args); }
            if (m.end) { 
                endFuns.push(function(result) { return m.end(context, result); }); 
            }
        },
        monitoringContext = {
            end: function(result) {
                endFuns.forEach(function(f) { f(result); });
            }
        };
    
    self.collectors.forEach(function(m) { doStart(m, {}); });
    return monitoringContext;
};

/** Monitor a set of EventEmitter objects, where each object is analogous to a thread. The objects
should emit 'start' and 'end' when they begin doing the operation being instrumented. This is useful
for monitoring concurrently executing instances of loop.js#Loop. 

Call either as monitorObjects(obj1, obj2, ...) or monitorObjects([obj1, obj2, ...], 'start', 'end') */
Monitor.prototype.monitorObjects = function(objs, startEvent, endEvent) {
    var self = this;
    
    if (!(objs instanceof Array)) {
        objs = util.argarray(arguments);
        startEvent = endEvent = null;
    }

    startEvent = startEvent || 'start';
    endEvent = endEvent || 'end';

    objs.forEach(function(o) {
        var mon;
        o.on(startEvent, function(args) {
            mon = self.start(args);
        });
        o.on(endEvent, function(result) {
            mon.end(result);
        });
    });

    return self;
};

/** Emit the 'update' event and reset the statistics for the next window */
Monitor.prototype.update = function() {
    this.emit('update', this.interval, this.stats);
    util.forEach(this.interval, function(name, stats) {
        if (stats.length > 0) {
            stats.clear();
        }
    });
};

/** Track the runtime of an operation, storing stats in a stats.js#Histogram  */
function RuntimeCollector() {
    var self = this;
    self.stats = new Histogram();
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context) { self.stats.put(new Date() - context.start); };
}

/** Track HTTP response codes, storing stats in a stats.js#ResultsCounter object. The client must call 
.end({res: http.ClientResponse}). */
function ResultCodesCollector() {
    var self = this;
    self.stats = new ResultsCounter();
    self.end = function(context, http) { self.stats.put(http.res.statusCode); };
}

/** Track the concurrent executions (ie. stuff between calls to .start() and .end()), storing in a 
stats.js#Peak. */
function ConcurrencyCollector() {
    var self = this, c = 0;
    self.stats = new Peak();
    self.start = function() { c++; };
    self.end = function() { self.stats.put(c--); };
}

/** Track the size of HTTP request bodies sent by adding up the content-length headers. This function
doesn't really work as you'd hope right now, since it doesn't work for chunked encoding messages and 
doesn't return actual bytes over the wire (headers, etc). */
function RequestBytesCollector() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) {
        if (http && http.req && http.req.headers && http.req.headers['content-length']) {
            self.stats.put(http.req.headers['content-length']);
        }
    };
}

/** Track the size of HTTP response bodies. It doesn't account for headers! */
function ResponseBytesCollector() {
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
function UniquesCollector() {
    var self = this;
    self.stats = new Uniques();
    self.end = function(context, http) { 
        if (http && http.req) { self.stats.put(http.req.path); }
    };
}

/** Define new statistics that Monitor can track by adding to Monitor.StatsCollectors. Each entry should
be a class with: 
- stats, a member which implements the standard interface found in stats.js
- start(context, args), optional, called when execution of the instrumented code is about to start
- end(context, result), optional, called when the instrumented code finishes executing */
Monitor.StatsCollectors = {
    'runtime': RuntimeCollector,
    'latency': RuntimeCollector,
    'result-codes': ResultCodesCollector,
    'concurrency': ConcurrencyCollector,
    'request-bytes': RequestBytesCollector,
    'response-bytes': ResponseBytesCollector,
    'uniques': UniquesCollector,
};


// -----------------
// MonitorGroup
// -----------------
/** MonitorGroup represents a group of Monitor instances. Calling MonitorGroup('runtime').start('myfunction')
is equivalent to creating a Monitor('runtime') for myfunction and and calling start(). MonitorGroup can 
also emit regular 'update' events as well as log the statistics from the interval to disk.

@param arguments contain names of the statistics to track. Register more statistics by extending
                 Monitor.StatsCollectors. */
var MonitorGroup = exports.MonitorGroup = function MonitorGroup(statsNames) {
    EventEmitter.call(this);

    var summaryFun = function() {
        var summary = {};
        util.forEach(this, function(monitorName, stats) {
            if (monitorName === 'summary') { return; }
            summary[monitorName] = {};
            util.forEach(stats, function(statName, stat) {
                summary[monitorName][statName] = stat.summary();
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

util.inherits(MonitorGroup, EventEmitter);

/** Pre-initialize monitors with the given names. This allows construction overhead to take place all at 
once if desired. */
MonitorGroup.prototype.initMonitors = function(monitorNames) {
    var self = this;
    monitorNames = (monitorNames instanceof Array) ? monitorNames : [].concat.apply([], arguments);
    monitorNames.forEach(function(name) { 
        self.monitors[name] = new Monitor(self.statsNames);
        self.stats[name] = self.monitors[name].stats;
        self.interval[name] = self.monitors[name].interval;
    });
    return self;
};

/** All the Monitors in this set should gather statistics for each intervalMs period. MonitorGroup should 
generate 'update' events */
MonitorGroup.prototype.setUpdateIntervalMs = function(interval) {
    this.updater.setUpdateIntervalMs(interval);
    return this;
};

/** Call .start() for the named monitor */
MonitorGroup.prototype.start = function(monitorName, args) {
    monitorName = monitorName || '';
    if (!this.monitors[monitorName]) {
        this.initMonitors([monitorName]);
    }
    return this.monitors[monitorName].start(args);
};

/** Like Monitor.monitorObjects() except each object's 'start' event should include the monitor name as
its first argument. See monitoring.test.js for an example. */
MonitorGroup.prototype.monitorObjects = function(objs, startEvent, endEvent) {
    var self = this, ctxs = {};

    if (!(objs instanceof Array)) {
        objs = util.argarray(arguments);
        startEvent = endEvent = null;
    }

    startEvent = startEvent || 'start';
    endEvent = endEvent || 'end';

    objs.forEach(function(o) {
        o.on(startEvent, function(monitorName, args) {
            ctxs[monitorName] = self.start(monitorName, args);
        });
        o.on(endEvent, function(monitorName, result) {
            if (ctxs[monitorName]) { ctxs[monitorName].end(result); }
        });
    });
    return self;
};

/** Set the file name or stats.js#LogFile object that statistics are logged to; null for default */
MonitorGroup.prototype.setLogFile = function(logNameOrObject) {
    this.logNameOrObject = logNameOrObject;
};

/** Log statistics each time an 'update' event is emitted? */
MonitorGroup.prototype.setLoggingEnabled = function(enabled) {
    if (enabled) {
        this.logger = this.logger || new StatsLogger(this, this.logNameOrObject).start();
    } else if (this.logger) {
        this.logger.stop();
        this.logger = null;
    }
    return this;
};

/** Emit the update event and reset the statistics for the next window */
MonitorGroup.prototype.update = function() {
    this.emit('update', this.interval, this.stats);
    util.forEach(this.monitors, function (name, m) { m.update(); });
};


// -----------------
// StatsLogger
// -----------------
/** StatsLogger writes interval stats from a Monitor or MonitorGroup to disk each time it emits 'update' */
var StatsLogger = exports.StatsLogger = function StatsLogger(monitor, logNameOrObject) {
    this.logNameOrObject = logNameOrObject || ('results-' + START.getTime() + '-stats.log');
    this.monitor = monitor;
    this.logger_ = this.log_.bind(this);
};
StatsLogger.prototype.start = function() {
    this.createdLog = (typeof this.logNameOrObject === 'string');
    this.log = this.createdLog ? new LogFile(this.logNameOrObject) : this.logNameOrObject;
    this.log.put('[');
    this.monitor.on('update', this.logger_);
    return this;
};
StatsLogger.prototype.stop = function() {
    this.log.put(']');
    if (this.createdLog) {
        this.log.close();
        this.log = null;
    }
    this.monitor.removeListener('update', this.logger_);
    return this;
};
StatsLogger.prototype.log_ = function(interval) {
    this.log.put(JSON.stringify(interval.summary()) + ',\n');
};

// =================
// Private methods
// =================
function UpdateEventGenerator(parent, updateIntervalMs) {
    this.parent = parent;
    this.setUpdateIntervalMs(updateIntervalMs);
}
UpdateEventGenerator.prototype.setUpdateIntervalMs = function(milliseconds) {
    clearTimeout(this.updateTimeoutId);
    this.scheduleUpdate_(milliseconds);
};
UpdateEventGenerator.prototype.scheduleUpdate_ = function(milliseconds) {
    var self = this;
    if (milliseconds > 0) {
        self.updateTimeoutId = setTimeout(
            function() { 
                self.scheduleUpdate_(milliseconds);
                self.parent.update();
            }, 
            milliseconds);
    }
};