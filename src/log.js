// ------------------------------------
// Logs
// ------------------------------------
//
// Each time nodeloadlib is used, three result files are created:
// 1. results-<timestamp>-stats.log: Contains a log of all the statistics in JSON format
// 2. results-<timestamp>-err.log: Contains all failed HTTP request/responses
// 3. results-<timestamp>-summary.html: A HTML summary page of the load test 
//
var logsOpen;
openAllLogs = function() {
    if (logsOpen)
        return;

    if (DISABLE_LOGS) {
        STATS_LOG = new NullLog();
        ERROR_LOG = new NullLog();
    } else {
        qputs("Opening log files.");
        STATS_LOG = new LogFile('results-' + START + '-stats.log');
        ERROR_LOG = new LogFile('results-' + START + '-err.log');
        SUMMARY_HTML = 'results-' + START + '-summary.html';
        
        // stats log should be a proper JSON array: output initial "["
        STATS_LOG.put("[");
    }

    logsOpen = true;
}

closeAllLogs = function() {
    // stats log should be a proper JSON array: output final "]"
    STATS_LOG.put("]");

    STATS_LOG.close();
    ERROR_LOG.close();

    if (!DISABLE_LOGS) {
        qputs("Closed log files.");
    }
}

// Initialize & open all log files
if (typeof DISABLE_LOGS == "undefined")
    DISABLE_LOGS = false;

openAllLogs();
