/*jslint laxbreak: true, undef: true */
/*global setTimeout: false */

// -----------------------------------------
// Event-based looping
// -----------------------------------------
// 
// Nodeload uses the node.js event loop to schedule iterations of a particular function. In order for
// this to work, the function must cooperate by accepting a loopFun as its first argument and call 
// loopFun() when it completes each iteration. This is refered to as "event-based looping" in nodeload.
// 
// This file defines the generic Loop class for looping on an arbitrary function, and a number
// of other event based loops for predefined tasks, such as tracking the latency of the loop body.
// 

var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('./util');
var EventEmitter = require('events').EventEmitter;
}

/** LOOP_DEFAULTS defines all of the parameters that used with Loop.create() and Scheduler.schedule() */
var LOOP_DEFAULTS = {
    fun: null,                  // A function to execute which accepts the parameters (loopFun, args).
                                // The value of args is the return value of argGenerator() or the args
                                // parameter if argGenerator is null. The function must call 
                                // loopFun(results) when it completes.
    argGenerator: null,         // A function which is called once when the loop is started. The return
                                // value is passed to fun as the "args" parameter. This is useful when
                                // concurrency > 1, and each "thread" should have its own args.
    args: null,                 // If argGenerator is NOT specified, then this is passed to the fun as
                                // "args".
    concurrency: 1,             // Number of concurrent calls of fun() (Scheduler only)
    rps: Infinity,              // Target number of time per second to call fun()
    duration: Infinity,         // Maximum duration of this loop in seconds
    numberOfTimes: Infinity,    // Maximum number of times to call fun()
    delay: 0,                   // Seconds to wait before calling fun() for the first time
    monitored: true             // Does this loop need to finish in order for a call to the containing
                                // Scheduler.startAll() to complete
};

/** Loop wraps an arbitrary function to be executed in a loop. Each iteration of the loop is
scheduled in the node.js event loop using process.nextTick(), which allows other events in the loop to be
handled as the loop executes.

@param fun          an asynchronous function that calls loopFun(result) when it finishes:
                    
                        function(loopFun, args) {
                            ...
                            loopFun(result);
                        }
                    
                    use LoopUtils.funLoop() to wrap a simple, non-asynchronous functions.
@param args         passed as-is as the second argument to fun
@param conditions   a list of functions that are called at the beginning of every loop. If any 
                    function returns false, the loop terminates. Loop#timeLimit and Loop#maxExecutions 
                    are conditions that can be used here.
@param delay        number of seconds before the first iteration of fun is executed */
var Loop = exports.Loop = function Loop(fun, args, conditions, delay, monitored) {
    EventEmitter.call(this);
    this.id = util.uid();
    this.fun = fun;
    this.args = args;
    this.conditions = conditions || [];
    this.delay = delay;
    this.monitored = monitored;
    this.running = false;
};

/** Static method to create a Loop from a spec object. LOOP_DEFAULTS lists the supported parameters. */ 
Loop.create = function(spec) {
    util.defaults(spec, LOOP_DEFAULTS);

    var fun = (spec.rps < Infinity)
                ? Loop.rpsLoop(spec.rps, spec.fun)
                : spec.fun,
        args = spec.argGenerator && spec.argGenerator(),
        conditions = [];

    if (spec.numberOfTimes > 0 && spec.numberOfTimes < Infinity) {
        conditions.push(Loop.maxExecutions(spec.numberOfTimes));
    }
    if (spec.duration > 0 && spec.duration < Infinity) {
        var duration = (spec.delay && spec.delay > 0)
                        ? spec.duration + spec.delay
                        : spec.duration;
        conditions.push(Loop.timeLimit(duration));
    }

    return new Loop(fun, args, conditions, spec.delay, spec.monitored);
};

util.inherits(Loop, EventEmitter);

/** Start executing "Loop.fun" with the arguments, "Loop.args", until any
condition in "Loop.conditions" returns false. The loop begins after a delay of
"Loop.delay" seconds. When the loop completes, the user defined function, callback is
called. */
Loop.prototype.start = function() {
    var self = this,
        startLoop = function() {
            self.emit('start');
            self.loop_();
        };

    if (self.running) { return; }
    self.running = true;
    
    if (self.delay && self.delay > 0) {
        setTimeout(startLoop, self.delay * 1000);
    } else {
        process.nextTick(startLoop);
    }
    
    return this;
};

Loop.prototype.stop = function() {
    this.running = false;
};

/** Calls each function in Loop.conditions. Returns false if any function returns false */
Loop.prototype.checkConditions_ = function() {
    return this.running && this.conditions.every(function(c) { return c(); });
};

/** Checks conditions and schedules the next loop iteration */
Loop.prototype.loop_ = function() {
    var self = this,
        callback = function(result) { 
            self.emit('enditeration', result);
            self.loop_();
        },
        callFun = function() {
            self.emit('startiteration', self.args);
            self.fun(callback, self.args);
        };

    if (self.checkConditions_()) {
        process.nextTick(callFun);
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


// Helpers for dealing with Loop loop functions

/** A wrapper for any existing function so it can be used by Loop. e.g.:
        myfun = function(x) { return x+1; }
        new Loop(Loop.funLoop(myfun), args, [Loop.timeLimit(10)], 0) */
Loop.funLoop = function(fun) {
    return function(loopFun, args) {
        loopFun(fun(args));
    };
};
/** Wrap a loop function. For each iteration, calls startRes = start(args) before calling fun(), and
calls finish(result-from-fun, startRes) when fun() finishes. */
Loop.loopWrapper = function(fun, start, finish) {
    return function(loopFun, args) {
        var startRes = start && start(args),
            finishFun = function(result) {
                if (result === undefined) {
                    util.qputs('Function result is null; did you forget to call loopFun(result)?');
                }

                if (finish) { finish(result, startRes); }
                
                loopFun(result);
            };
        fun(finishFun, args);
    };
};
/** Wrapper for executing a Loop function rps times per second. */
Loop.rpsLoop = function(rps, fun) {
    var finished, lagging, 
        timeout = (rps && rps > 0) ? (1/rps * 1000) : 0,
        finishFun = function(loopFun) {
            finished = true;
            if (lagging) {
                loopFun(); 
            }
        };

    return function(loopFun, args) {
        finished = false;
        lagging = (timeout <= 0);
        if (!lagging) {
            setTimeout(function() { 
                lagging = !finished;
                if (!lagging) {
                    loopFun();
                }
            }, timeout);
        }
        var callback = function() { finishFun(loopFun); };
        fun(callback, args);
    };
};


// -----------------------------------------
// Scheduler for event-based loops
// -----------------------------------------
//
// Scheduler provides a way to define and group sets of Loops that are started and stopped together.

/** A scheduler starts and monitors a group of Loops. Each Loop can be monitored or unmonitored. When all
monitored loops complete, Scheduler considers the entire group to be complete and stops all unmonitored
loops. */
var Scheduler = exports.Scheduler = function Scheduler() {
    this.id = util.uid();
    this.loops = [];
    this.running = false;
};

util.inherits(Scheduler, EventEmitter);

/** Primary function for adding new Loops. Start all scheduled loops by calling startAll(). If the
scheduler is already started, the loops are started immediately upon scheduling. */
Scheduler.prototype.schedule = function(spec) {
    util.defaults(spec, LOOP_DEFAULTS);

    // concurrency is handled by creating multiple loops with portions of the load
    spec.numberOfTimes /= spec.concurrency;
    spec.rps /= spec.concurrency;
    for (var i = 0; i < spec.concurrency; i++) {
        this.addLoop(Loop.create(spec));
    }
    
    return this;
};
Scheduler.prototype.addLoop = function(loop) {
    this.loops.push(loop);
    // If the scheduler is running (startAll() was already called), start new loops immediately
    if (this.running) { 
        this.startLoop_(loop); 
    }
    return this;
};
/** Start all scheduled Loops. When the loops complete, 'end' event is emitted. */
Scheduler.prototype.startAll = function() {
    var self = this;
    if (self.running || self.loops.length === 0) { return; }
    self.running = true;
    process.nextTick(function() { self.emit('start'); });
    for (var i in self.loops) {
        if (!self.loops[i].running) {
            self.startLoop_(self.loops[i]);
        }
    }
    return self;
};
/** Force all loops to finish */
Scheduler.prototype.stopAll = function() {
    this.loops.forEach(function(l) { l.stop(); });
    return this;
};
Scheduler.prototype.startLoop_ = function(loop) {
    var self = this;
    loop.start();
    loop.on('end', function() { self.checkFinished_(); });
    return self;
};
/** Iterate all loops and see if any are still running. If all loops are complete, then emit 'end'. */
Scheduler.prototype.checkFinished_ = function() {
    var isAllUnmonitoredLoops = true,
        hasRunningLoop = false;

    this.loops.forEach(function (l) {
        if (l.monitored && l.running) {
            return false;
        }

        isAllUnmonitoredLoops = isAllUnmonitoredLoops && !l.monitored;
        hasRunningLoop = hasRunningLoop || l.running; 
    });
    if (isAllUnmonitoredLoops && hasRunningLoop) {
        return false;
    }

    this.running = false;
    this.stopAll();
    this.emit('end');
    return true;
};
