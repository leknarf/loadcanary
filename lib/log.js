// ------------------------------------
// Logs
// ------------------------------------
//
// This file defines LOGS.
//
// Each time nodeloadlib is used, three result files are created:
// 1. results-<timestamp>-stats.log: Contains a log of all the statistics in JSON format
// 2. results-<timestamp>-err.log: Contains all failed HTTP request/responses
// 3. results-<timestamp>-summary.html: A HTML summary page of the load test 
//

var LOGS = exports.LOGS = {
    opened: false,
    STATS_LOG: new NullLog(),
    ERROR_LOG: new NullLog(),
    SUMMARY_HTML: new NullLog(),
    open: function() {
        if (this.opened) { return };

        qputs("Opening log files.");
        this.STATS_LOG = new LogFile('results-' + START + '-stats.log');
        this.ERROR_LOG = new LogFile('results-' + START + '-err.log');
        this.SUMMARY_HTML = new LogFile('results-' + START + '-summary.html');
        
        // stats log should be a proper JSON array: output initial "["
        this.STATS_LOG.put("[");
    },
    close: function() {
        // stats log should be a proper JSON array: output final "]"
        this.STATS_LOG.put("]");

        this.STATS_LOG.close();
        this.ERROR_LOG.close();
        this.SUMMARY_HTML.close();

        if (this.opened) {
            qputs("Closed log files.");
        }
        this.opened = false;
    }
}

// Open all log files
NODELOAD_CONFIG.on('apply', function() { 
    if (NODELOAD_CONFIG.LOGS_ENABLED) {
        LOGS.open();
    }
});