// // -----------------------------------------
// // Scheduler for event-based loops
// // -----------------------------------------
// //
// // This file defines SCHEDULER, Scheduler, and Job.
// //
// // This file provides a convenient way to define and group sets of Jobs. A Job is an event-based loop
// // that runs at a certain rate with a set of termination conditions. A Scheduler groups a set of Jobs and
// // starts and stops them together.
// 
// /** JOB_DEFAULTS defines all of the parameters that can be set in a job specifiction passed to
//     Scheduler.schedule(spec). */
// var JOB_DEFAULTS = {
//     fun: null,                  // A function to execute which accepts the parameters (loopFun, args).
//                                 // The value of args is the return value of argGenerator() or the args
//                                 // parameter if argGenerator is null. The function must call 
//                                 // loopFun(results) when it completes.
//     argGenerator: null,         // A function which is called once when the job is started. The return
//                                 // value is passed to fun as the "args" parameter. This is useful when
//                                 // concurrency > 1, and each "thread" should have its own args.
//     args: null,                 // If argGenerator is NOT specified, then this is passed to the fun as "args".
//     concurrency: 1,             // Number of concurrent calls of fun()
//     rps: Infinity,              // Target number of time per second to call fun()
//     duration: Infinity,         // Maximum duration of this job in seconds
//     numberOfTimes: Infinity,    // Maximum number of times to call fun()
//     delay: 0,                   // Seconds to wait before calling fun() for the first time
//     monitored: true             // Does this job need to finish in order for SCHEDULER.startAll() to end?
// };
// 
// /** A scheduler starts and monitors a group of Jobs. Jobs can be monitored or unmonitored. When all
// monitored jobs complete, Scheduler considers the entire job group to be complete. Scheduler automatically
// stops all unmonitored jobs in the same group. See the Job class below. */
// var Scheduler = exports.Scheduler = function() {
//     this.id = Utils.uid();
//     this.jobs = [];
//     this.running = false;
//     this.callback = null;
// }
// Scheduler.prototype = {
//     /** Primary function for defining and adding new Jobs. Start all scheduled jobs by calling
//     startAll(). If the scheduler is already startd, the jobs are started immediately upon scheduling. */
//     schedule: function(spec) {
//         Utils.defaults(spec, JOB_DEFAULTS);
// 
//         // concurrency is handled by creating multiple jobs with portions of the load
//         var scheduledJobs = []
//         spec.numberOfTimes /= spec.concurrency;
//         spec.rps /= spec.concurrency;
//         for (var i = 0; i < spec.concurrency; i++) {
//             var j = new Job(spec);
//             this.addJob(j);
//             scheduledJobs.push(j);
// 
//             // If the scheduler is running (startAll() was already called), start new jobs immediately
//             if (this.running) { 
//                 this.startJob_(j); 
//             }
//         }
//         
//         return scheduledJobs;
//     },
//     addJob: function(job) {
//         this.jobs.push(job);
//     },
//     /** Start all scheduled Jobs. When the jobs complete, the user defined function, callback is called. */
//     startAll: function(callback) {
//         if (this.running) return;
// 
//         this.callback = callback;
//         this.running = true;
//         for (var i in this.jobs) {
//             if (!this.jobs[i].started) {
//                 this.startJob_(this.jobs[i]);
//             }
//         };
//     },
//     /** Force all jobs to finish. The user defined callback will still be called. */
//     stopAll: function() {
//         this.jobs.forEach(function(j) { j.stop() });
//     },
//     startJob_: function(job) {
//         var scheduler = this;
//         job.start(function() { scheduler.checkFinished_() });
//     },
//     /** Iterate all jobs and see if any are still running. If all jobs are complete, then call the user
//     defined callback function. */
//     checkFinished_: function() {
//         var foundRunningJob = false,
//             foundMonitoredJob = false;
// 
//         for (var i in this.jobs) {
//             foundMonitoredJob = foundMonitoredJob || this.jobs[i].monitored;
//             foundRunningJob = foundRunningJob || (this.jobs[i].started && !this.jobs[i].done);
//             if (this.jobs[i].monitored && this.jobs[i].started && !this.jobs[i].done) {
//                 return false;
//             }
//         }
//         if (!foundMonitoredJob && foundRunningJob) {
//             return false;
//         }
// 
//         this.running = false;
//         this.stopAll();
//         this.jobs = [];
// 
//         if (this.callback != null) {
//             // Clear out callback before calling it since function may actually call startAll() again.
//             var oldCallback = this.callback;
//             this.callback = null;
//             oldCallback();
//         }
// 
//         return true;
//     }
// }
// 
// var SCHEDULER = exports.SCHEDULER = new Scheduler();
// 
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

/** Loop wraps an arbitrary function to be executed in a loop. Each iteration of the loop is
scheduled in the node.js event loop using process.nextTick(), which allows other events in the loop to be
handled as the loop executes.

@param fun          a function:
                    
                        function(loopFun, args) {
                            ...
                            loopFun(result);
                        }
                    
                    that calls loopFun(result) when it finishes. Use LoopUtils.funLoop() to wrap a
                    function for use in a Loop.
@param args         passed as-is as the second argument to fun
@param conditions   a list of functions that are called at the beginning of every loop. If any 
                    function returns false, the loop terminates. See LoopConditions.
@param delay        number of seconds before the first iteration of fun is executed */
var Loop = exports.Loop = function Loop(fun, args, conditions, delay) {
    EventEmitter.call(this);
    this.fun = fun;
    this.args = args;
    this.conditions = conditions || [];
    this.delay = delay;
    this.stopped = true;
}

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

    if (!this.stopped) return;
    self.stopped = false;
    
    if (self.delay && self.delay > 0) {
        setTimeout(function() { startLoop() }, self.delay * 1000);
    } else {
        startLoop();
    }
}

Loop.prototype.stop =function() {
    this.stopped = true;
},

/** Calls each function in Loop.conditions. Returns false if any function returns false */
Loop.prototype.checkConditions_ = function() {
    return !this.stopped && this.conditions.every(function(c) { return c(); });
},

/** Checks conditions and schedules the next loop iteration */
Loop.prototype.loop_ = function() {
    if (this.checkConditions_()) {
        var self = this,
            callback = function() { self.loop_() };
        process.nextTick(function() { self.fun(callback, self.args) });
    } else {
        self.emit('end');
    }
}

/** Loop.Conditions contains predefined functions that can be used in Loop.conditions */
Loop.Conditions = {
    /** Returns false after a given number of seconds */
    timeLimit: function(seconds) {
        var start = new Date();
        return function() { 
            return (seconds === Infinity) || ((new Date() - start) < (seconds * 1000));
        };
    },
    /** Returns false after a given number of iterations */
    maxExecutions: function(numberOfTimes) {
        var counter = 0;
        return function() { 
            return (numberOfTimes === Infinity) || (counter++ < numberOfTimes)
        };
    }
};


/** Loop.Utils contains helpers for dealing with Loop loop functions */
var Loop.Utils = {
    getLoop: function(spec) {
        var fun = (spec.rps && spec.rps < Infinity)
                    ? Loop.Utils.rpsLoop(spec.rps, spec.fun)
                    : spec.fun,
            args = spec.argGenerator && spec.argGenerator(),
            conditions = [];

        if (spec.numberOfTimes && spec.numberOfTimes > 0 && spec.numberOfTimes < Infinity) {
            conditions.push(Loop.Conditions.maxExecutions(spec.numberOfTimes));
        }
        if (spec.duration && spec.duration > 0 && spec.duration < Infinity) {
            var duration = (spec.delay && spec.delay > 0)
                            ? spec.duration + spec.delay
                            : spec.duration;
            conditions.push(LoopConditions.timeLimit(duration));
        }

        return new Loop(fun, args, conditions, spec.delay);
    },
    /** A wrapper for any existing function so it can be used by Loop. e.g.:
            myfun = function(x) { return x+1; }
            new Loop(LoopUtils.funLoop(myfun), args, [LoopConditions.timeLimit(10)], 0) */
    funLoop: function(fun) {
        return function(loopFun, args) {
            loopFun(fun(args));
        }
    },
    /** Wrap a loop function. For each iteration, calls startRes = start(args) before calling fun(), and
    calls finish(result-from-fun, startRes) when fun() finishes. */
    loopWrapper: function(fun, start, finish) {
        return function(loopFun, args) {
            var startRes = start && start(args),
                finishFun = function(result) {
                    if (result === undefined) {
                        qputs('Function result is null; did you forget to call loopFun(result)?');
                    }

                    finish && finish(result, startRes);
                    
                    loopFun(result);
                }
            fun(finishFun, args);
        }
    },
    /** Wrapper for executing a Loop function rps times per second. */
    rpsLoop: function(rps, fun) {
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
            var callback = function() { finishFun(loopFun) }
            fun(callback, args);
        }
    }
}