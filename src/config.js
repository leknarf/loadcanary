// ------------------------------------
// Nodeload configuration
// ------------------------------------
//
// The functions in this file control the behavior of the nodeload. They are called when the library
// is included:
//
//      var nl = require('./lib/nodeloadlib').quiet().usePort(10000);
//      nl.runTest(...);
//

/** Suppress all console output */
exports.quiet = function() {
    NODELOAD_CONFIG.QUIET = true;
    return exports;
}

/** Start the nodeload HTTP server on the given port */
exports.usePort = function(port) {
    NODELOAD_CONFIG.HTTP_PORT = port;
    return exports;
}

/** Do not start the nodeload HTTP server */
exports.disableServer = function() {
    NODELOAD_CONFIG.HTTP_ENABLED = false;
    return exports;
}

/** Set the number of milliseconds between TEST_MONITOR 'update' events when tests are running */
exports.setMonitorIntervalMs = function(milliseconds) {
    NODELOAD_CONFIG.MONITOR_INTERVAL_MS = milliseconds;
    return exports;
}

/** Set the number of milliseconds between auto-refreshes for the summary webpage */
exports.setAjaxRefreshIntervalMs = function(milliseconds) {
    NODELOAD_CONFIG.AJAX_REFRESH_INTERVAL_MS = milliseconds;
    return exports;
}

/** Do not write any logs to disk */
exports.disableLogs = function() {
    NODELOAD_CONFIG.LOGS_ENABLED = false;
    return exports;
}

/** Set the number of milliseconds between pinging slaves when running distributed load tests */
exports.setSlavePingIntervalMs = function(milliseconds) {
    NODELOAD_CONFIG.SLAVE_PING_INTERVAL_MS = milliseconds;
}


// =================
// Private
// =================
var NODELOAD_CONFIG = {
    QUIET: false,

    HTTP_ENABLED: true,
    HTTP_PORT: Number(process.env['HTTP_PORT']) || 8000,

    MONITOR_INTERVAL_MS: 2000,

    AJAX_REFRESH_INTERVAL_MS: 2000,

    LOGS_ENABLED: true,
    
    SLAVE_PING_INTERVAL_MS: 3000,
    
    eventEmitter: new events.EventEmitter(),
    on: function(event, fun) {
        this.eventEmitter.on(event, fun);
    },
    apply: function() {
        this.eventEmitter.emit('apply');
    }
}

process.nextTick(function() { NODELOAD_CONFIG.apply() });