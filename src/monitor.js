// ------------------------------------
// Test monitor
// ------------------------------------
//
sys.inherits(TestMonitor, events.EventEmitter);
function TestMonitor() {
    events.EventEmitter.call(this);
    this.tests = [];
    this.interval = 2000;
    if (typeof MONITOR_INTERVAL != "undefined") {
        this.interval = MONITOR_INTERVAL;
    }
}
TestMonitor.prototype.addTest = function(test) {
    this.tests.push(test);
    this.emit('test', test);
}
TestMonitor.prototype.start = function() {
    this.emit('start', this.tests);
    monitor = this;
    SCHEDULER.schedule({
        fun: funLoop(function() { monitor.update() }),
        rps: 1000/this.interval,
        delay: this.interval/1000,
        monitored: false
    });
}
TestMonitor.prototype.update = function() {
    this.emit('beforeUpdate', this.tests);
    this.emit('update', this.tests);
}
TestMonitor.prototype.stop = function() {
    this.emit('update', this.tests);
    this.emit('end', this.tests);
    this.tests = [];
}

/** The global test monitor. Register functions here that should be run at regular intervals during
    the load test, such as processing & logging statistics. */
TEST_MONITOR = new TestMonitor();
TEST_MONITOR.on('update', function() { qprint('.') });
TEST_MONITOR.on('end', function() { qprint('done.') });