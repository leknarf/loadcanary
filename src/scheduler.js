// -----------------------------------------
// Scheduler for event-based loops
// -----------------------------------------
//
// 
//

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
/** A scheduler starts and monitors a group of Jobs. There should only be a single instance of Scheduler,
    SCHEDULER. See also the Job class below. */
Scheduler = function() {
    this.id=uid();
    this.jobs = [];
    this.running = false;
    this.callback = null;
}
Scheduler.prototype = {
    /** Primary function for defining and adding new Jobs. Start all scheduled jobs by calling startAll(). If
        the scheduler is already startd, the jobs are started immediately upon scheduling. */
    schedule: function(spec) {
        defaults(spec, JOB_DEFAULTS);

        // concurrency is handled by creating multiple jobs with portions of the load
        var scheduledJobs = []
        spec.numberOfTimes /= spec.concurrency;
        spec.rps /= spec.concurrency;
        for (var i = 0; i < spec.concurrency; i++) {
            var s = new Job(spec);
            this.addJob(s);
            scheduledJobs.push(s);

            // If the scheduler is already running (startAll() was already called), start new jobs immediately
            if (this.running) { this.startJob(s); }
        }
        
        return scheduledJobs;
    },
    addJob: function(job) {
        this.jobs.push(job);
    },
    startJob: function(job) {
        var scheduler = this;
        job.start(function() { scheduler.checkFinished() });
    },
    /** Start all scheduled Jobs. When the jobs complete, the user defined function, callback is called. */
    startAll: function(callback) {
        if (this.running)
            return;

        var len = this.jobs.length;
        for (var i = 0; i < len; i++) {
            if (!this.jobs[i].started) {
                this.startJob(this.jobs[i]);
            }
        }

        this.callback = callback;
        this.running = true;
    },
    /** Force all jobs to finish. The user defined callback will still be called. */
    stopAll: function() {
        for (var i in this.jobs) {
            this.jobs[i].stop();
        }
    },
    /** Iterate all jobs and see if any are still running. If all jobs are complete, then call
        the user defined callback function. */
    checkFinished: function() {
        var foundMonitoredJob = false;
        var foundRunningJob = false;
        for (var i in this.jobs) {
            foundMonitoredJob = foundMonitoredJob || this.jobs[i].monitored;
            foundRunningJob = foundRunningJob || (this.jobs[i].started && !this.jobs[i].done);
            if (this.jobs[i].monitored && this.jobs[i].started && !this.jobs[i].done)
                return false;
        }
        if (!foundMonitoredJob && foundRunningJob)
            return false;

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

/** At a high level, a Job encapsulates a single load test. A Job instances represents a function that is
    being executed at a certain rate for a set number of times or duration. See JOB_DEFAULTS for a list
    of the configuration values that can be provided in the job specification, spec.
    
    Jobs can be monitored or unmonitored. All monitored jobs must finish before Scheduler considers 
    the entire job group to be complete. Scheduler automatically stops all unmonitored jobs in the
    same group when all monitored jobs complete. */
function Job(spec) {
    this.id = uid();
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
    /** Scheduler calls this method to start the job. The user defined function, callback, is called when the
        job completes. This function basically creates and starts a ConditionalLoop instance (which is an "event 
        based loop"). */
    start: function(callback) {
        clearTimeout(this.warningTimeoutId); // Cancel "didn't start job" warning

        if (this.fun == null)
            qputs("WARN: scheduling a null loop");
        if (this.started)
            return;
            
        var job = this;
        var fun = this.fun;
        var conditions = [];

        if (this.rps != null && this.rps < Infinity) {
            var rps = this.rps;
            fun = rpsLoop(rps, fun);
        }
        if (this.numberOfTimes != null && this.numberOfTimes < Infinity) {
            var numberOfTimes = this.numberOfTimes;
            conditions.push(maxExecutions(numberOfTimes));
        }
        if (this.duration != null && this.duration < Infinity) {
            var duration = this.duration;
            if (this.delay != null && this.delay > 0)
                duration += this.delay;
            conditions.push(timeLimit(duration));
        }
        if (this.argGenerator != null) {
            this.args = this.argGenerator();
        }

        this.callback = callback;
        this.loop = new ConditionalLoop(fun, this.args, conditions, this.delay);
        this.loop.start(function() {
            job.done = true;
            if (job.callback != null) {
                job.callback();
            }
        });
        
        this.started = true;
    },
    stop: function() {
        if (this.loop != null) {
            this.loop.stop();
        }
    },
    clone: function() {
        var job = this;
        var other = new Job({
            fun: job.fun,
            args: job.args,
            argGenerator: job.argGenerator,
            rps: job.rps,
            duration: job.duration,
            numberOfTimes: job.numberOfTimes,
            delay: job.delay,
            monitored: job.monitored
        });
        return other;
    },
}

// Instantiate global SCHEDULER singleton instance
if (typeof SCHEDULER == "undefined")
    SCHEDULER = new Scheduler();