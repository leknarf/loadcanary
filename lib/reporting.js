// ------------------------------------
// Progress Reporting
// ------------------------------------
//
// This file defines Report, Chart, and REPORT_MANAGER
//
// This file listens for 'update' events from TEST_MONITOR and trends test statistics. The trends are
// summarized in HTML page file written to disk and available via the nodeload HTTP server.

var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var START = new Date();
var util = require('./util');
var querystring = require('querystring');
var LogFile = require('./stats').LogFile;
var template = require('./template');
var config = require('./config');

var REPORT_SUMMARY_TEMPLATE = require('./summary.tpl.js').REPORT_SUMMARY_TEMPLATE;
var NODELOAD_CONFIG = config.NODELOAD_CONFIG;
var DYGRAPH_SOURCE = require('./dygraph.tpl.js').DYGRAPH_SOURCE;
var HTTP_SERVER = require('./http').HTTP_SERVER;

exports.setAjaxRefreshIntervalMs = function(ms) { config.setAjaxRefreshIntervalMs(ms); return exports; };
exports.disableLogs = function() { config.disableLogs(); return exports; };
exports.disableServer = function() { config.disableServer(); return exports; };
exports.usePort = function() { config.usePort(); return exports; };
exports.quiet = function() { config.quiet(); return exports; };
}

var Chart, timeFromStart;

/** A Report contains a summary object and set of charts.
@param name A name for the report. Generally corresponds to the test name.
@param updater A function(report) that should update the summary and chart data. */
var Report = exports.Report = function(name) {
    this.name = name;
    this.uid = util.uid();
    this.summary = {};
    this.charts = {};
};
Report.prototype = {
    getChart: function(name) {
        if (!this.charts[name]) {
            this.charts[name] = new Chart(name);
        }
        return this.charts[name];
    },
    /** Update this report automatically each time the Monitor emits an 'update' event */
    updateFromMonitor: function(monitor) {
        monitor.on('update', this.doUpdateFromMonitor_.bind(this, monitor, ''));
        return this;
    },
    /** Update this report automatically each time the MonitorSet emits an 'update' event */
    updateFromMonitorSet: function(monitorset) {
        var self = this;
        monitorset.on('update', function() {
            util.forEach(monitorset.monitors, function(monitorname, monitor) {
                self.doUpdateFromMonitor_(monitor, monitorname);
            });
        });
        return self;
    },
    doUpdateFromMonitor_: function(monitor, monitorname) {
        var self = this;
        monitorname = monitorname ? monitorname + ' ' : '';
        util.forEach(monitor.stats, function(statname, stat) {
            util.forEach(stat.summary(), function(name, val) {
                self.summary[self.name + ' ' + monitorname + statname + ' ' + name] = val;
            });
            self.getChart(monitorname + statname)
                .put(monitor.interval[statname].summary());
        });
    }
};

/** A Chart represents a collection of lines over time represented as:

    columns: ["x values", "line 1", "line 2", "line 3", ...]
    rows:   [[timestamp1, line1[0], line2[0], line3[0], ...],
             [timestamp2, line1[1], line2[1], line3[1], ...],
             [timestamp3, line1[2], line2[2], line3[2], ...],
             ...
            ]

@param name A name for the chart */
var Chart = exports.Chart = function(name) {
    this.name = name;
    this.uid = util.uid();
    this.columns = ["time"];
    this.rows = [[timeFromStart()]];
};
Chart.prototype = {
    /** Put a row of data into the chart. The current time will be used as the x-value. The lines in the
    chart are extracted from the "data". New lines can be added to the chart at any time by including it
    in data.

    @param data An object representing one row of data: {
                    "line name 1": value1
                    "line name 2": value2
                    ...
                }
    */
    put: function(data) {
        var self = this, row = [timeFromStart()]; 
        util.forEach(data, function(column, val) {
            var col = self.columns.indexOf(column);
            if (col < 0) {
                col = self.columns.length;
                self.columns.push(column);
                self.rows[0].push(0);
            }
            row[col] = val;
        });
        self.rows.push(row);
    }
};

var ReportSet = exports.ReportSet = function() {
    this.reports = [];
    this.refreshIntervalMs = 2000;
};
ReportSet.prototype = {
    addReport: function(report) {
        report = (typeof report === 'string') ? new Report(report) : report;
        this.reports.push(report);
        return report;
    },
    startLogger: function(logNameOrObject) {
        if (this.logger) { return; }
        logNameOrObject = logNameOrObject || ('results-' + START.getTime() + '.html');
        this.logger = (typeof logNameOrObject === 'string') ? new LogFile(logNameOrObject) : logNameOrObject;
        this.loggingTimeoutId = setTimeout(this.write_.bind(this), this.refreshIntervalMs);
        return this;
    },
    stopLogger: function() {
        if (!this.logger) { return; }
        clearTimeout(this.loggingTimeoutId);
        this.logger.close();
        this.logger = null;
        return this;
    },
    reset: function() {
        this.reports = {};
    },
    getHtml: function() {
        var self = this,
            t = template.create(REPORT_SUMMARY_TEMPLATE);
        return t({
            DYGRAPH_SOURCE: DYGRAPH_SOURCE,
            querystring: querystring,
            refreshPeriodMs: self.refreshIntervalMs, 
            reports: self.reports
        });
    },
    write_: function() {
        this.loggingTimeoutId = setTimeout(this.write_.bind(this), this.refreshIntervalMs);
        this.logger.clear(this.getHtml());
    }
};

// =================
// Global stuff
// =================

/** A global report manager used by nodeload to keep the summary webpage up to date during a load test */
var REPORT_MANAGER = exports.REPORT_MANAGER = new ReportSet();
NODELOAD_CONFIG.on('apply', function() { 
    REPORT_MANAGER.refreshIntervalMs = NODELOAD_CONFIG.AJAX_REFRESH_INTERVAL_MS;
    if (NODELOAD_CONFIG.LOGS_ENABLED) {
        REPORT_MANAGER.startLogger();
    }
});

HTTP_SERVER.on('^/$', function(url, req, res) {
    var html = REPORT_MANAGER.getHtml();
    res.writeHead(200, {"Content-Type": "text/html", "Content-Length": html.length});
    res.write(html);
    res.end();
});
HTTP_SERVER.on('^/reports$', function(url, req, res) {
    var json = JSON.stringify(REPORT_MANAGER.reports); 
    res.writeHead(200, {"Content-Type": "application/json", "Content-Length": json.length});
    res.write(json);
    res.end();
});

// =================
// Private methods
// =================

/** current time from start of nodeload process in 100ths of a minute */
function timeFromStart() {
    return (Math.floor((new Date().getTime() - START) / 600) / 100);
}
