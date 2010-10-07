// ------------------------------------
// Test monitor
// ------------------------------------
//
// This file defines TEST_MONITOR.
//
// TEST_MONITOR is an EventEmitter that emits periodic 'update' events. This allows tests to be
// introspected at regular intervals for things like gathering statistics, generating reports, etc.
//

/** An event emitter sending these events:
    - 'test', function(test): addTest() was called, which created the new test, 'test'.
    - 'start', function(tests): startTests() was called and all of the tests, 'tests' will be started.
    - 'end', function(tests): all tests, 'tests', finished.
    - 'update', function(tests): emitted every TestMonitor.intervalMs while 'tests' are running.
    - 'afterUpdate', function(tests): emitted after every 'update' event.
*/
function TestMonitor(intervalMs) {
    events.EventEmitter.call(this);
    this.intervalMs = intervalMs || 2000;
    this.tests = [];
}
TestMonitor.prototype = {
    addTest: function(test) {
        this.tests.push(test);
        this.emit('test', test);
    },
    start: function() {
        this.emit('start', this.tests);
        monitor = this;
        
        // schedule on next process tick so NODELOAD_CONFIG.on('apply') can happen
        process.nextTick(function() {
            SCHEDULER.schedule({
                fun: LoopUtils.funLoop(function() { monitor.update() }),
                rps: 1000/monitor.intervalMs,
                delay: monitor.intervalMs/1000,
                monitored: false
            });
        });
    },
    update: function() {
        this.emit('update', this.tests);
        this.emit('afterUpdate', this.tests);
    },
    stop: function() {
        this.update();
        this.emit('end', this.tests);
        this.tests = [];
    }
}
Utils.inherits(TestMonitor, events.EventEmitter);

/** The global test monitor. Register functions here that should be run at regular intervals during
    the load test, such as processing & logging statistics. */
var TEST_MONITOR = exports.TEST_MONITOR = new TestMonitor();
TEST_MONITOR.on('update', function() { qprint('.') });
TEST_MONITOR.on('end', function() { qprint('done.') });

NODELOAD_CONFIG.on('apply', function() { 
    TEST_MONITOR.intervalMs = NODELOAD_CONFIG.MONITOR_INTERVAL_MS;
});
