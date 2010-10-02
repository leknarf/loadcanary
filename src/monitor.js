// ------------------------------------
// Test monitor
// ------------------------------------
//
sys.inherits(TestMonitor, events.EventEmitter);
function TestMonitor() {
    events.EventEmitter.call(this);
    this.interval = 2000;
    this.tests = [];
}
TestMonitor.prototype.addTest = function(test) {
    this.tests.push(test);
    this.emit('test', test);
}
TestMonitor.prototype.start = function() {
    this.emit('start');
    monitor = this;
    SCHEDULER.schedule({
        fun: funLoop(function() { monitor.update() }),
        rps: 1000/this.interval,
        delay: this.interval/1000,
        monitored: false
    });
}
TestMonitor.prototype.update = function() {
    this.emit('update');
}
TestMonitor.prototype.stop = function() {
    this.emit('update');
    this.emit('end');
}

/** The global test monitor. Register functions here that should be run at regular intervals during
    the load test, such as processing & logging statistics. */
var TEST_MONITOR = new TestMonitor();
TEST_MONITOR.on('update', function() { qprint('.') });
TEST_MONITOR.on('end', function() { qprint('done.') });