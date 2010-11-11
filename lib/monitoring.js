// ------------------------------------
// Monitoring
// ------------------------------------
//
// This file defines TEST_MONITOR.
//
// TEST_MONITOR is an EventEmitter that emits periodic 'update' events. This allows tests to be
// introspected at regular intervals for things like gathering statistics, generating reports, etc.
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
var Monitor = exports.Monitor = function Monitor() { // arguments contains stats names
    EventEmitter.call(this);
    this.targets = [];
    this.setStats.apply(this, arguments);
    this.updater = new UpdateEventGenerator(this);
};

util.inherits(Monitor, EventEmitter);

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

Monitor.prototype.updateEvery = function(intervalMs) {
    this.updater.updateEvery(intervalMs);
    return this;
};

Monitor.prototype.disableUpdates = function() {
    return this.updateEvery(0);
};

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

Monitor.prototype.doUpdate = function() {
    this.emit('update', this.interval, this.stats);
    util.forEach(this.interval, function(name, stats) {
        if (stats.length > 0) {
            stats.clear();
        }
    });
};

function RuntimeMonitor() {
    var self = this;
    self.stats = new Histogram();
    self.start = function(context) { context.start = new Date(); };
    self.end = function(context) { self.stats.put(new Date() - context.start); };
}

function ResultCodeMonitor() {
    var self = this;
    self.stats = new ResultsCounter();
    self.end = function(context, http) { self.stats.put(http.res.statusCode); };
}

function ConcurrencyMonitor() {
    var self = this, c = 0;
    self.stats = new Peak();
    self.start = function() { c++; };
    self.end = function() { self.stats.put(c--); };
}

function RequestBytesMonitor() {
    var self = this;
    self.stats = new Accumulator();
    self.end = function(context, http) {
        if (http && http.req && http.req.headers && http.req.headers['content-length']) {
            self.stats.put(http.req.headers['content-length']);
        }
    };
}

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

function UniquesMonitor() {
    var self = this;
    self.stats = new Uniques();
    self.end = function(context, http) { 
        if (http && http.req) { self.stats.put(http.req.path); }
    };
}

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
var MonitorSet = exports.MonitorSet = function MonitorSet(statsNames) { // arguments contains stats names
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

MonitorSet.prototype.updateEvery = function(intervalMs) {
    this.updater.updateEvery(intervalMs);
    util.forEach(this.monitors, function (name, m) { m.updateEvery(intervalMs); });
    return this;
};

MonitorSet.prototype.disableUpdates = function() {
    return this.updateEvery(0);
};

MonitorSet.prototype.start = function(monitor, args) {
    monitor = monitor || '';
    if (!this.monitors[monitor]) {
        this.init([monitor]);
    }
    return this.monitors[monitor].start(args);
};

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

MonitorSet.prototype.doUpdate = function() {
    this.emit('update', this.interval, this.stats);
};


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
function UpdateEventGenerator(monitor) {
    this.monitor = monitor;
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
                self.monitor.doUpdate();
            }, 
            intervalMs);
    }
};