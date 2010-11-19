// ------------------------------------
// Monitoring
// ------------------------------------
//
// This file defines Monitor and MonitorGroup, and StatsLogger
//

var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var START = new Date();
var util = require('./util');
var PeriodicUpdater = util.PeriodicUpdater;
var StatsCollectors = require('./collectors');
var EventEmitter = require('events').EventEmitter;
var LogFile = require('./stats').LogFile;
}

var StatsLogger;

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

@param arguments contain names of the statistics to track. Add additional statistics to collectors.js.
*/
var Monitor = exports.Monitor = function Monitor() { // arguments 
    EventEmitter.call(this);
    PeriodicUpdater.call(this); // adds updateInterval property and calls update()
    this.targets = [];
    this.setStats.apply(this, arguments);
};

util.inherits(Monitor, EventEmitter);

/** Set the statistics this monitor should gather. */
Monitor.prototype.setStats = function(stats) { // arguments contains stats names
    var self = this;
    self.collectors = [];
    self.stats = {};
    self.interval = {};
    stats = (stats instanceof Array) ? stats : [].concat.apply([], arguments);
    stats.forEach(function(stat) {
        var name = stat, params;
        if (typeof stat === 'object') {
            name = stat.name;
            params = stat;
        }
        var Collector = StatsCollectors[name];
        if (!Collector) { 
            throw new Error('No collector for statistic: ' + name); 
        }
        if (!Collector.disableIntervalCollection) {
            var intervalCollector = new Collector(params);
            self.collectors.push(intervalCollector);
            self.interval[name] = intervalCollector.stats;
        }
        if (!Collector.disableCumulativeCollection) {
            var cumulativeCollector = new Collector(params);
            self.collectors.push(cumulativeCollector);
            self.stats[name] = cumulativeCollector.stats;
        }
    });
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
    PeriodicUpdater.call(this);

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
    var summary = interval.summary();
    summary.ts = new Date();
    this.log.put(JSON.stringify(summary) + ',\n');
};
