var loop = require('../lib/loop'),
    Loop = loop.Loop,
    Scheduler = loop.Scheduler;

module.exports = {
    'example: a basic rps loop with set duration': function(assert, beforeExit) {
        var i = 0, start = new Date(), lasttime = start, duration,
            l = Loop.create({
                fun: function(loopFun) { 
                    var now = new Date();
                    assert.ok(Math.abs(now - lasttime) < 210, (now - lasttime).toString());
                    lasttime = now;

                    i++;
                    loopFun(); 
                },
                rps: 5, // times per second (every 200ms)
                duration: 1 // second
            }).start();
        
        l.on('end', function() { duration = new Date() - start; });
        
        beforeExit(function() {
            assert.equal(i, 5, 'loop executed incorrect number of times');
            assert.ok(!l.running, 'loop still flagged as running');
            assert.ok(Math.abs(duration - 1000) < 30, '1000 == ' + duration);
        });
    },
    'test numberOfTimes loop': function(assert, beforeExit) {
        var i = 0,
            l = Loop.create({
                fun: function(loopFun) { i++; loopFun(); },
                rps: 5,
                numberOfTimes: 3
            }).start();
            
        beforeExit(function() {
            assert.equal(3, i, 'loop executed incorrect number of times');
        });
    },
    'test emits start and stop events': function(assert, beforeExit) {
        var started, ended, 
            l = Loop.create({
                fun: function(loopFun) { loopFun(); },
                rps: 10,
                numberOfTimes: 3
            }).start();

        l.on('start', function() { started = true; });
        l.on('end', function() { ended = true; });
 
        beforeExit(function() {
            assert.ok(started, 'start never emitted');
            assert.ok(ended, 'end never emitted');
        });
    },
    
    'test concurrency': function(assert, beforeExit) {
        var i = 0, start = new Date(), duration, s = new Scheduler();
        s.schedule({
            fun: function(loopFun) { i++; loopFun(); },
            rps: 10,
            duration: 1,
            concurrency: 5
        }).startAll();
        
        s.on('end', function() { duration = new Date() - start; });
    
        assert.equal(s.loops.length, 5);
        beforeExit(function() {
            assert.equal(i, 10, 'loop executed incorrect number of times');
            assert.ok(s.loops.every(function(l){ return !l.running; }), 'loops still flagged as running');
            assert.ok(Math.abs(duration - 1000) < 30, '1000 == ' + duration);
        });
    },
    'scheduler emits events': function(assert, beforeExit) {
        var s = new Scheduler(), started = false, ended = false;
        s.schedule({
            fun: function(loopFun) { loopFun(); },
            numberOfTimes: 3
        }).startAll();
    
        s.on('start', function() { started = true; });
        s.on('end', function() { ended = true; });
    
        beforeExit(function() {
            assert.ok(started, 'start never emitted');
            assert.ok(ended, 'end never emitted');
        });
    },
    'test mixed monitored and unmonitored loops': function(assert, beforeExit) {
        var s = new Scheduler();
        s.schedule({
            fun: function(loopFun) { loopFun(); },
            numberOfTimes: 50,
            concurrency: 5
        });
        s.schedule({
            fun: function(loopFun) { loopFun(); },
            rps: 1,
            monitored: false
        });
        s.startAll();
    
        var unmonitoredLoops = s.loops.filter(function(l) { return !l.monitored; });
        assert.equal(s.loops.length, 6);
        assert.equal(unmonitoredLoops.length, 1);
        assert.ok(s.loops.every(function(l){ return l.running; }), 'not all loops started');
        beforeExit(function() {
            assert.ok(s.loops.every(function(l){ return !l.running; }), 'loops still flagged as running');
        });
    },
    'test all unmonitored loops': function(assert, beforeExit) {
        var s = new Scheduler(), ended = false;
        s.schedule({
            fun: function(loopFun) { loopFun(); },
            rps: 2,
            concurrency: 2,
            monitored: false
        });
        s.startAll();
        s.on('end', function() { ended = true; });
    
        var unmonitoredLoops = s.loops.filter(function(l) { return !l.monitored; });
        assert.equal(s.loops.length, unmonitoredLoops.length);
        
        s.loops.forEach(function(l) { l.stop(); });

        beforeExit(function() {
            assert.ok(ended, 'scheduler never finished');
        });
    }
};