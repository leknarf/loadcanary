// -----------------------------------------
// Event-based looping
// -----------------------------------------
// 
// This file defines Loop and MultiLoop.
//
// Nodeload uses the node.js event loop to repeatedly call a function. In order for this to work, the
// function cooperates by accepting a function, finished, as its first argument and calls finished()
// when it completes. This is refered to as "event-based looping" in nodeload.
// 
/*jslint laxbreak: true, undef: true */
/*global setTimeout: false */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('./util');
var PeriodicUpdater = util.PeriodicUpdater;
var EventEmitter = require('events').EventEmitter;
}

/** LOOP_OPTIONS defines all of the parameters that used with Loop.create(), MultiLoop() */
var LOOP_OPTIONS = {
    fun: null,                  // A function to execute which accepts the parameters (finished, args).
                                // The value of args is the return value of argGenerator() or the args
                                // parameter if argGenerator is null. The function must call 
                                // finished(results) when it completes.
    argGenerator: null,         // A function which is called once when the loop is started. The return
                                // value is passed to fun as the "args" parameter. This is useful when
                                // concurrency > 1, and each "thread" should have its own args.
    args: null,                 // If argGenerator is NOT specified, then this is passed to the fun as
                                // "args".
    rps: Infinity,              // Target number of time per second to call fun()
    duration: Infinity,         // Maximum duration of this loop in seconds
    numberOfTimes: Infinity,    // Maximum number of times to call fun()
    concurrency: 1,             // (MultiLoop only) Number of concurrent calls of fun()
                                //
    concurrencyProfile: null,   // (MultiLoop only) array indicating concurrency over time:
                                //      [[time (seconds), # users], [time 2, users], ...]
                                // For example, ramp up from 0 to 100 "threads" and back down to 0 over
                                // 20 seconds:
                                //      [[0, 0], [10, 100], [20, 0]]
                                //
    rpsProfile: null            // (MultiLoop only) array indicating execution rate over time:
                                //      [[time (seconds), rps], [time 2, rps], ...]
                                // For example, ramp up from 100 to 500 rps and then down to 0 over 20
                                // seconds:
                                //      [[0, 100], [10, 500], [20, 0]]
};

/** Loop wraps an arbitrary function to be executed in a loop. Each iteration of the loop is scheduled
in the node.js event loop using process.nextTick(), which allows other events in the loop to be handled
as the loop executes. Loop emits the events 'start' (before the first iteration), 'end', 'startiteration'
and 'enditeration'.

@param funOrSpec    Either a loop specification object or a loop function. LOOP_OPTIONS lists all the 
                    supported fields in a loop specification.

                    A loop function is an asynchronous function that calls finished(result) when it
                    finishes:
                    
                        function(finished, args) {
                            ...
                            finished(result);
                        }
                    
                    use the static method Loop.funLoop(f) to wrap simple, non-asynchronous functions.
@param args         passed as-is as the second argument to fun
@param conditions   a list of functions that are called at the beginning of every loop. If any 
                    function returns false, the loop terminates. Loop#timeLimit and Loop#maxExecutions 
                    are conditions that can be used here. 
@param rps          max number of times per second this loop should execute */
var Loop = exports.Loop = function Loop(funOrSpec, args, conditions, rps) {
    EventEmitter.call(this);
    
    if (typeof funOrSpec === 'object') {
        var spec = util.defaults(funOrSpec, LOOP_OPTIONS);

        funOrSpec = spec.fun;
        args = spec.argGenerator ? spec.argGenerator() : spec.args;
        conditions = [];
        rps = spec.rps;

        if (spec.numberOfTimes > 0 && spec.numberOfTimes < Infinity) {
            conditions.push(Loop.maxExecutions(spec.numberOfTimes));
        }
        if (spec.duration > 0 && spec.duration < Infinity) {
            conditions.push(Loop.timeLimit(spec.duration));
        }
    }

    this.__defineGetter__('rps', function() { return rps; });
    this.__defineSetter__('rps', function(val) {
        rps = (val >= 0) ? val : Infinity;
        this.timeout_ = Math.floor(1/rps * 1000);
        if (this.restart_ && this.timeout_ < Infinity) {
            var oldRestart = this.restart_;
            this.restart_ = null;
            oldRestart();
        }
    });
    
    this.id = util.uid();
    this.fun = funOrSpec;
    this.args = args;
    this.conditions = conditions || [];
    this.running = false;
    this.rps = rps;
};

util.inherits(Loop, EventEmitter);

/** Start executing this.fun with the arguments, this.args, until any condition in this.conditions
returns false. When the loop completes the 'end' event is emitted. */
Loop.prototype.start = function() {
    var self = this,
        startLoop = function() {
            self.emit('start');
            self.loop_();
        };

    if (self.running) { return; }
    self.running = true;
    process.nextTick(startLoop);
    return this;
};

Loop.prototype.stop = function() {
    this.running = false;
};

/** Calls each function in Loop.conditions. Returns false if any function returns false */
Loop.prototype.checkConditions_ = function() {
    return this.running && this.conditions.every(function(c) { return c(); });
};

/** Checks conditions and schedules the next loop iteration. 'startiteration' is emitted before each
iteration and 'enditeration' is emitted after. */
Loop.prototype.loop_ = function() {
    
    var self = this, result, active, lagging,
        callfun = function() {
            if (self.timeout_ === Infinity) { 
                self.restart_ = callfun;
                return;
            }

            result = null; active = true; lagging = (self.timeout_ <= 0);
            if (!lagging) {
                setTimeout(function() { 
                    lagging = active;
                    if (!lagging) { self.loop_(); }
                }, self.timeout_);
            }
            self.emit('startiteration', self.args);
            var start = new Date();
            self.fun(function(res) { 
                    active = false;
                    result = res;
                    self.emit('enditeration', result);
                    if (lagging) { self.loop_(); }
                }, self.args);
        };

    if (self.checkConditions_()) {
        process.nextTick(callfun);
    } else {
        self.running = false;
        self.emit('end');
    }
};


// Predefined functions that can be used in Loop.conditions

/** Returns false after a given number of seconds */
Loop.timeLimit = function(seconds) {
    var start = new Date();
    return function() { 
        return (seconds === Infinity) || ((new Date() - start) < (seconds * 1000));
    };
};
/** Returns false after a given number of iterations */
Loop.maxExecutions = function(numberOfTimes) {
    var counter = 0;
    return function() { 
        return (numberOfTimes === Infinity) || (counter++ < numberOfTimes);
    };
};


// Helpers for dealing with loop functions

/** A wrapper for any existing function so it can be used by Loop. e.g.:
        myfun = function(x) { return x+1; }
        new Loop(Loop.funLoop(myfun), args, [Loop.timeLimit(10)], 0) */
Loop.funLoop = function(fun) {
    return function(finished, args) {
        finished(fun(args));
    };
};
/** Wrap a loop function. For each iteration, calls startRes = start(args) before calling fun(), and
calls finish(result-from-fun, startRes) when fun() finishes. */
Loop.loopWrapper = function(fun, start, finish) {
    return function(finished, args) {
        var startRes = start && start(args),
            finishFun = function(result) {
                if (result === undefined) {
                    util.qputs('Function result is null; did you forget to call finished(result)?');
                }

                if (finish) { finish(result, startRes); }
                
                finished(result);
            };
        fun(finishFun, args);
    };
};


// -----------------------------------------
// MultiLoop 
// -----------------------------------------
//

/** MultiLoop accepts a single loop specification, but allows it to be executed concurrently by creating
multiple Loop instances. The execution rate and concurrency are changed over time using profiles. 
LOOP_OPTIONS lists the supported specification parameters. */ 
var MultiLoop = exports.MultiLoop = function MultiLoop(spec) {
    EventEmitter.call(this);

    this.spec = util.extend({}, util.defaults(spec, LOOP_OPTIONS));
    this.loops = [];
    this.concurrencyProfile = spec.concurrencyProfile || [[0, spec.concurrency]];
    this.rpsProfile = spec.rpsProfile || [[0, spec.rps]];
    this.updater_ = this.update_.bind(this);
    this.finishedChecker_ = this.checkFinished_.bind(this);
};

util.inherits(MultiLoop, EventEmitter);

/** Start all scheduled Loops. When the loops complete, 'end' event is emitted. */
MultiLoop.prototype.start = function() {
    if (this.running) { return; }
    this.running = true;
    this.startTime = new Date();
    this.rps = 0;
    this.concurrency = 0;
    this.loops = [];
    this.loopConditions_ = [];

    if (this.spec.numberOfTimes > 0 && this.spec.numberOfTimes < Infinity) {
        this.loopConditions_.push(Loop.maxExecutions(this.spec.numberOfTimes));
    }
    
    if (this.spec.duration > 0 && this.spec.duration < Infinity) {
        this.endTimeoutId = setTimeout(this.stop.bind(this), this.spec.duration * 1000);
    }

    process.nextTick(this.emit.bind(this, 'start'));
    this.update_();
    return this;
};

/** Force all loops to finish */
MultiLoop.prototype.stop = function() {
    if (!this.running) { return; }
    clearTimeout(this.endTimeoutId);
    clearTimeout(this.updateTimeoutId);
    this.running = false;
    this.loops.forEach(function(l) { l.stop(); });
    this.emit('remove', this.loops);
    this.emit('end');
    this.loops = [];
};

MultiLoop.prototype.getProfileValue_ = function(profile, time) {
    // Given a profile in the format [[time, value], [time, value], ...], return the value corresponding
    // to the given time. Transitions between points are currently assumed to be linear, and value=0 at time=0
    // unless otherwise specified in the profile.
    if (!profile || profile.length === 0) { return 0; }
    if (time < 0) { return profile[0][0]; }

    var lastval = [0,0];
    for (var i = 0; i < profile.length; i++) {
        if (profile[i][0] === time) { 
            return profile[i][1]; 
        } else if (profile[i][0] > time) {
            var dx = profile[i][0]-lastval[0], dy = profile[i][1]-lastval[1];
            return Math.floor((time-lastval[0]) / dx * dy + lastval[1]);
        }
        lastval = profile[i];
    }
    return profile[profile.length-1][1];
};

MultiLoop.prototype.getProfileNextTimeout_ = function(profile, time) {
    // Given a profile in the format [[time, value], [time, value], ...], and the current time, return
    // the number of milliseconds before the profile value will change by 1.
    if (time < 0) { return -time; }

    var MIN_TIMEOUT = 1000, lastval = [0,0];
    for (var i = 0; i < profile.length; i++) {
        if (profile[i][0] > time) {
            var dt = profile[i][0]-lastval[0],
                millisecondsPerUnitChange = dt / (profile[i][1]-lastval[1]) * 1000;
            return Math.max(MIN_TIMEOUT, Math.min(dt, millisecondsPerUnitChange));
        }
        lastval = profile[i];
    }
    return Infinity;
};

MultiLoop.prototype.update_ = function() {
    var i, now = Math.floor((new Date() - this.startTime) / 1000),
        concurrency = this.getProfileValue_(this.concurrencyProfile, now),
        rps = this.getProfileValue_(this.rpsProfile, now),
        timeout = Math.min(this.getProfileNextTimeout_(this.concurrencyProfile, now), this.getProfileNextTimeout_(this.rpsProfile, now));
    
    if (concurrency < this.concurrency) {
        var removed = this.loops.splice(concurrency);
        removed.forEach(function(l) { l.stop(); });
        this.emit('remove', removed);
    } else if (concurrency > this.concurrency) {
        var loops = [];
        for (i = 0; i < concurrency-this.concurrency; i++) {
            var args = this.spec.argGenerator ? this.spec.argGenerator() : this.spec.args,
                loop = new Loop(this.spec.fun, args, this.loopConditions_, 0).start();
            loop.on('end', this.finishedChecker_);
            loops.push(loop);
        }
        this.loops = this.loops.concat(loops);
        this.emit('add', loops);
    }
    
    if (concurrency !== this.concurrency || rps !== this.rps) {
        var rpsPerLoop = (rps / concurrency);
        this.loops.forEach(function(l) { l.rps = rpsPerLoop; });
        this.emit('rps', rps);
    }
    
    this.concurrency = concurrency;
    this.rps = rps;

    if (timeout < Infinity) {
        this.updateTimeoutId = setTimeout(this.updater_, timeout);
    }
};

MultiLoop.prototype.checkFinished_ = function() {
    if (!this.running) { return true; }
    if (this.loops.some(function (l) { return l.running; })) { return false; }
    this.running = false;
    this.emit('end');
    return true;
};
