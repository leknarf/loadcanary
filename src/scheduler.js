// -----------------------------------------
// Scheduler for event-based loops
// -----------------------------------------
//
// This file defines SCHEDULER, Scheduler, and Job.
//
// This file provides a convenient way to define and group sets of Jobs. A Job is an event-based loop
// that runs at a certain rate with a set of termination conditions. A Scheduler groups a set of Jobs and
// starts and stops them together.

/** JOB_DEFAULTS defines all of the parameters that can be set in a job specifiction passed to
    Scheduler.schedule(spec). */
var JOB_DEFAULTS = {
    fun: null,                  // A function to execute which accepts the parameters (loopFun, args).
                                // The value of args is the return value of argGenerator() or the args
                                // parameter if argGenerator is null. The function must call 
                                // loopFun(results) when it completes.
    argGenerator: null,         // A function which is called once when the job is started. The return
                                // value is passed to fun as the "args" parameter. This is useful when
                                // concurrency > 1, and each "thread" should have its own args.
    args: null,                 // If argGenerator is NOT specified, then this is passed to the fun as "args".
    concurrency: 1,             // Number of concurrent calls of fun()
    rps: Infinity,              // Target number of time per second to call fun()
    duration: Infinity,         // Maximum duration of this job in seconds
    numberOfTimes: Infinity,    // Maximum number of times to call fun()
    delay: 0,                   // Seconds to wait before calling fun() for the first time
    monitored: true             // Does this job need to finish in order for SCHEDULER.startAll() to end?
};

/** A scheduler starts and monitors a group of Jobs. Jobs can be monitored or unmonitored. When all
monitored jobs complete, Scheduler considers the entire job group to be complete. Scheduler automatically
stops all unmonitored jobs in the same group. See the Job class below. */
var Scheduler = exports.Scheduler = function() {
    this.id = Utils.uid();
    this.jobs = [];
    this.running = false;
    this.callback = null;
}
Scheduler.prototype = {
    /** Primary function for defining and adding new Jobs. Start all scheduled jobs by calling
    startAll(). If the scheduler is already startd, the jobs are started immediately upon scheduling. */
    schedule: function(spec) {
        Utils.defaults(spec, JOB_DEFAULTS);

        // concurrency is handled by creating multiple jobs with portions of the load
        var scheduledJobs = []
        spec.numberOfTimes /= spec.concurrency;
        spec.rps /= spec.concurrency;
        for (var i = 0; i < spec.concurrency; i++) {
            var j = new Job(spec);
            this.addJob(j);
            scheduledJobs.push(j);

            // If the scheduler is running (startAll() was already called), start new jobs immediately
            if (this.running) { 
                this.startJob_(j); 
            }
        }
        
        return scheduledJobs;
    },
    addJob: function(job) {
        this.jobs.push(job);
    },
    /** Start all scheduled Jobs. When the jobs complete, the user defined function, callback is called. */
    startAll: function(callback) {
        if (this.running) return;

        this.callback = callback;
        this.running = true;
        for (var i in this.jobs) {
            if (!this.jobs[i].started) {
                this.startJob_(this.jobs[i]);
            }
        };
    },
    /** Force all jobs to finish. The user defined callback will still be called. */
    stopAll: function() {
        this.jobs.forEach(function(j) { j.stop() });
    },
    startJob_: function(job) {
        var scheduler = this;
        job.start(function() { scheduler.checkFinished_() });
    },
    /** Iterate all jobs and see if any are still running. If all jobs are complete, then call the user
    defined callback function. */
    checkFinished_: function() {
        var foundRunningJob = false,
            foundMonitoredJob = false;

        for (var i in this.jobs) {
            foundMonitoredJob = foundMonitoredJob || this.jobs[i].monitored;
            foundRunningJob = foundRunningJob || (this.jobs[i].started && !this.jobs[i].done);
            if (this.jobs[i].monitored && this.jobs[i].started && !this.jobs[i].done) {
                return false;
            }
        }
        if (!foundMonitoredJob && foundRunningJob) {
            return false;
        }

        this.running = false;
        this.stopAll();
        this.jobs = [];

        if (this.callback != null) {
            // Clear out callback before calling it since function may actually call startAll() again.
            var oldCallback = this.callback;
            this.callback = null;
            oldCallback();
        }

        return true;
    }
}

var SCHEDULER = exports.SCHEDULER = new Scheduler();

/** At a high level, a Job is analogous to a thread. A Job instance represents a function that is being
executed at a certain rate for a set number of times or duration. See JOB_DEFAULTS for a list of the
configuration values that can be provided in the job specification, spec. */
var Job = exports.Job = function(spec) {
    this.id = Utils.uid();
    this.fun = spec.fun;
    this.args = spec.args;
    this.argGenerator = spec.argGenerator;
    this.rps = spec.rps;
    this.duration = spec.duration;
    this.numberOfTimes = spec.numberOfTimes;
    this.delay = spec.delay;
    this.monitored = spec.monitored;

    this.callback = null;
    this.started = false;
    this.done = false;
    
    var job = this;
    this.warningTimeoutId = setTimeout(function() { qputs("WARN: a job" + job.id + " was not started; Job.start() called?") }, 3000);
}
Job.prototype = {
    /** Scheduler calls this method to start the job. The user defined function, callback, is called when
    the job completes. This function basically creates and starts a ConditionalLoop instance (which is an
    "event based loop"). */
    start: function(callback) {
        if (this.started) { return };

        clearTimeout(this.warningTimeoutId); // Cancel "didn't start job" warning

        var job = this,
            fun = this.fun,
            conditions = [];

        if (this.rps && this.rps < Infinity) {
            fun = LoopUtils.rpsLoop(this.rps, fun);
        }
        if (this.numberOfTimes !== null && this.numberOfTimes < Infinity) {
            conditions.push(LoopConditions.maxExecutions(this.numberOfTimes));
        }
        if (this.duration !== null && this.duration < Infinity) {
            var duration = this.duration;
            if (this.delay !== null && this.delay > 0)
                duration += this.delay;
            conditions.push(LoopConditions.timeLimit(duration));
        }

        this.args = this.argGenerator && this.argGenerator();
        this.callback = callback;
        this.loop = new ConditionalLoop(fun, this.args, conditions, this.delay);
        this.loop.start(function() {
            job.done = true;
            if (job.callback) {
                job.callback();
            }
        });
        
        this.started = true;
    },
    stop: function() {
        this.started = true;
        this.done = true;
        if (this.loop) {
            this.loop.stop();
        }
    }
}