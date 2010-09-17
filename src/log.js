// ------------------------------------
// Logs
// ------------------------------------
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

qputs = function(s) {
    if (!QUIET) {
        sys.puts(s);
    }
}

qprint = function(s) {
    if (!QUIET) {
        sys.print(s);
    }
}

