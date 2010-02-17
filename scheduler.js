var sys = require('sys');
var http = require('http');

var schedules = [];
var onFinish = [];
var id = 0;

// -----------------------------------------
// Scheduler
// -----------------------------------------
function Schedule(fun) {
    this.id = id++;
    this.fun = fun;
    this.conditions = { rps: null, times: null, ms: null, delay: null };
    this.provideClient = { port: null, host: null };
    this.monitored = true;
}
Schedule.prototype = {
    withMax: function(number) {
        var schedule = this;
        return {
            timesPerSecond: function() {
                schedule.conditions.rps = number;
                return schedule;
            },
            times: function() {
                schedule.conditions.times = number;
                return schedule;
            },
            ms: function() {
                schedule.conditions.ms = number;
                return schedule;
            },
            msDelay: function() {
                schedule.conditions.delay = number;
            }
        }
    },
    withConcurrency: function(number) {
        this.concurrency = number;
        return this;
    },
    withClients: function(port, host) {
        this.provideClient = { port: port, host: host };
        return this;
    },
    clone: function() {
        var schedule = this;
        var other = new Schedule();
        other.id = id++;
        other.fun = schedule.fun;
        other.conditions = { rps: schedule.conditions.rps, times: schedule.conditions.times, ms: schedule.conditions.ms, delay: schedule.conditions.delay };
        other.concurrency = schedule.concurrency;
        other.provideClient = { port: schedule.provideClient.port, host: schedule.provideClient.host };
        other.monitored = schedule.monitored;
        return other;
    }
}

function schedule(fun, monitored) {
    if (monitored == null)
        monitored = true;

    var s = new Schedule(fun);
    s.monitored = monitored;
    schedules.push(s);
    return s;
}

function scheduleUnmonitored(fun) {
    return schedule(fun, false);
}

function onSchedulerFinishCall(funs) {
    if (funs.length == 0)
        funs = [funs];
    onFinish = funs;
}

function startSchedules(finishFuns) {
    if (finishFuns != null)
        onSchedulerFinishCall(finishFuns);
    var len = schedules.length;
    for (var i = 0; i < len; i++) {
        startSchedule(schedules[i]);
    }
}

function stopSchedules() {
    for (var i in schedules) {
        stopSchedule(schedules[i]);
    }
}

function startSchedule(s) {
    for (var i = 1; i < s.concurrency; i++) {
        var clone = s.clone();
        clone.concurrency = 1;
        schedules.push(clone);
        startSchedule(clone);
    }
    var finish = function() {
        s.done = true;
        if (s.monitored) {
            process.nextTick(checkAllFinished);
        }
    }
    if (s.conditions.rps != null) {
        s.loop = scheduleMultiplePerSec(s.fun, s.conditions.rps)
    } else {
        s.loop = scheduleLoop(s.fun);
    }
    if (s.conditions.times != null) {
        s.loop.addCondition(maxExecutions(s.conditions.times));
    }
    if (s.conditions.delay != null) {
        s.loop.setDelay(s.conditions.delay);
    }
    if (s.conditions.ms != null) {
        var limit = s.conditions.ms;
        if (s.conditions.delay != null)
            limit += s.conditions.delay;
        s.loop.addCondition(timeLimit(limit));
    }
    if (s.provideClient != null) {
        s.loop.client = http.createClient(s.provideClient.port, s.provideClient.host);
    }
    s.loop.start(finish);
}

function stopSchedule(s) {
    if (s.loop != null) {
        s.loop.stop();
    }
}

function checkAllFinished() {
    for (var i in schedules) {
        if (schedules[i].monitored && !schedules[i].done) {
            return;
        }
    }
    for (var i in schedules) {
        if (!schedules[i].monitored) {
            schedules[i].loop.stop();
        }
    }

    var finishFuns = onFinish;
    schedules = [];
    onFinish = [];

    for (var i in finishFuns) {
        process.nextTick(finishFuns[i]);
    }
}


// -----------------------------------------
// Looping definitions
// -----------------------------------------
function Loop(fun) {
    this.fun = fun;
    this.conditions = [];
    this.stopped = true;
    this.delay = 0;
}
Loop.prototype = {
    addCondition: function(condition) {
        this.conditions.push(condition);
        return this;
    },
    checkCondition: function() {
        if (this.stopped) {
            return false;
        }
        for (var i = 0; i < this.conditions.length; i++) {
            if (!this.conditions[i]()) {
                return false;
            }
        }
        return true;
    },
    setDelay: function(delayMs) {
        this.delay = delayMs;
    },
    loop: function() {
        if (this.checkCondition()) {
            var loop = this;
            process.nextTick(function() { loop.fun(function() { loop.loop() }, loop.client) });
        } else {
            if (this.finishFun != null)
                this.finishFun();
        }
    },
    start: function(finishFun) {
        this.finishFun = finishFun;
        this.stopped = false;
        if (this.delay > 0) {
            var loop = this;
            setTimeout(function() { loop.loop() }, this.delay);
        } else {
            this.loop();
        }
    },
    stop: function() {
        this.stopped = true;
    }
}

function scheduleLoop(fun) {
    return new Loop(fun);
}

function scheduleMultiple(fun, numberOfTimes) {
    return new Loop(fun).addCondition(maxExecutions(numberOfTimes));
} 

function scheduleFor(fun, numberOfMs) {
    return new Loop(fun).addCondition(timeLimit(numberOfMs));
}

function scheduleMultiplePerSec(fun, targetRps) {
    if (targetRps == Infinity) {
        return new Loop(fun);
    }

    var timeout = 1/targetRps * 1000;
    var finished = false;
    var lagging = false;
    var finishFun = function(loopFun) {
        finished = true;
        if (lagging) {
            loopFun();
        }
    };
    var wrapperFun = function(loopFun, client) {
        finished = false;
        if (timeout > 0) {
            setTimeout(function() { 
                if (!finished) {
                    lagging = true; 
                } else {
                    loopFun();
                }
            }, timeout);
            lagging = false;
        } else {
            lagging = true;
        }
        fun(function() { finishFun(loopFun) }, client);
    }
    return new Loop(wrapperFun);
}

function timeLimit(numberOfMs) {
    var start = new Date();
    return function() { 
        return (numberOfMs == Infinity) || ((new Date() - start) < numberOfMs)
    };
}

function maxExecutions(numberOfTimes) {
    var counter = 0;
    return function() { 
        return (numberOfTimes == Infinity) || (counter++ < numberOfTimes)
    };
}


// -----------------------------------------
// Utilities
// -----------------------------------------
function wrapRequestGenerator(generator) {
    return function(loopFun, client) {
        var request = generator(client);
        if (request == null) {
            sys.puts('HTTP request is null; did you forget to call return request?');
            loopfun(null, client);
        } else {
            request.finish(function(response) {
                if (response == null) {
                    sys.puts('HTTP response is null; did you forget to call loopFun(response)?');
                }
                loopFun(response, client);
            });
        }
    }
}

exports.schedule = schedule;
exports.scheduleUnmonitored = scheduleUnmonitored;
exports.onSchedulerFinishCall = onSchedulerFinishCall;
exports.startSchedules = startSchedules;
exports.startSchedule = startSchedule;
exports.stopSchedules = stopSchedules;
exports.wrapRequestGenerator = wrapRequestGenerator;