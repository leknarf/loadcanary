// ------------------------------------
// Progress Reporting
// ------------------------------------
//
// This file defines Report, Chart, and REPORT_MANAGER
//
// This file listens for 'update' events from TEST_MONITOR and trends test statistics. The trends are
// summarized in HTML page file written to disk and available via the nodeload HTTP server.

/** A Report contains a summary object and set of charts.

@param name A name for the report. Generally corresponds to the test name.
@param updater A function(report) that should update the summary and chart data. */
var Report = exports.Report = function(name, updater) {
    this.name = name;
    this.uid = Utils.uid();
    this.summary = {};
    this.charts = {};
    this.updater = updater;
}
Report.prototype = {
    getChart: function(name) {
        if (this.charts[name] == null)
            this.charts[name] = new Chart(name);
        return this.charts[name];
    },
    update: function() {
        if (this.updater != null) { this.updater(this); }
    }
}

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
    this.uid = Utils.uid();
    this.columns = ["time"];
    this.rows = [[timeFromTestStart()]];
}
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
        var row = [timeFromTestStart()]; 
        for (item in data) {
            var col = this.columns.indexOf(item);
            if (col < 0) {
                col = this.columns.length;
                this.columns.push(item);
                this.rows[0].push(0);
            }
            row[col] = data[item];
        }
        this.rows.push(row);
    }
}

/** The global report manager that keeps the summary webpage up to date during a load test */
var REPORT_MANAGER = exports.REPORT_MANAGER = {
    reports: {},
    addReport: function(report) {
        this.reports[report.name] = report;
    },
    getReport: function(name) {
        return this.reports[name];
    },
    updateReports: function() {
        for (var r in this.reports) {
            this.reports[r].update();
        }
        
        LOGS.SUMMARY_HTML.clear(REPORT_MANAGER.getHtml());
    },
    reset: function() {
        this.reports = {};
    },
    getHtml: function() {
        var t = template.create(REPORT_SUMMARY_TEMPLATE);
        return t({
            querystring: querystring, 
            refreshPeriodMs: NODELOAD_CONFIG.AJAX_REFRESH_INTERVAL_MS, 
            reports: this.reports
        });
    }
}


// =================
// Private methods
// =================

/** current time from start of nodeload process in 100ths of a minute */
function timeFromTestStart() {
    return (Math.floor((new Date().getTime() - START) / 600) / 100);
}

/** Returns an updater function that cna be used with the Report() constructor. This updater write the
current state of "stats" to the report summary and charts. */
function updateReportFromStats(stats) {
    return function(report) {
        for (var s in stats) {
            var stat = stats[s];
            var summary = stat.summary();
            if (stat.trend) {
                report.getChart(stat.name).put(summary.interval);
            }
            for (var i in summary.cumulative) {
                report.summary[stat.name + " " + i] = summary.cumulative[i];
            }
        }
    }
}

function getChartAsJson(chart) {
    return (chart == null) ? null : JSON.stringify(chart.rows);
}

/** Handler for all the requests to / and /data/main. See http.js#startHttpServer(). */
function serveReport(url, req, res) {
    if (req.method == "GET" && url == "/") {
        var html = REPORT_MANAGER.getHtml();
        res.writeHead(200, {"Content-Type": "text/html", "Content-Length": html.length});
        res.write(html);
    } else if (req.method == "GET" && req.url.match("^/data/([^/]+)/([^/]+)")) {
        var urlparts = querystring.unescape(req.url).split("/"),
            report = REPORT_MANAGER.getReport(urlparts[2]),
            retobj = null;
        if (report) {
            var chartname = urlparts[3];
            if (chartname == "summary") {
                retobj = report.summary;
            } else if (report.charts[chartname] != null) {
                retobj = report.charts[chartname].rows;
            }
        }
        if (retobj) {
            var json = JSON.stringify(retobj);
            res.writeHead(200, {"Content-Type": "application/json", "Content-Length": json.length});
            res.write(json);
        } else {
            res.writeHead(404, {"Content-Type": "text/html", "Content-Length": 0});
        }
    } else if (req.method == "GET" && url == "/data/") {
        var json = JSON.stringify(REPORT_MANAGER.reports);
        res.writeHead(200, {"Access-Control-Allow-Origin": "*", "Content-Type": "application/json", "Content-Length": json.length});
        res.write(json);
    } else {
        res.writeHead(405, {"Content-Length": 0});
    }
    res.end();
}

// Register report manager with test monitor
TEST_MONITOR.on('update', function() { REPORT_MANAGER.updateReports() });
TEST_MONITOR.on('end', function() { 
    for (var r in REPORT_MANAGER.reports) {
        REPORT_MANAGER.reports[r].updater = null;
    }
});
TEST_MONITOR.on('test', function(test) { 
    // when a new test is created, add a report that contains all the test stats
    if (test.stats) {
        REPORT_MANAGER.addReport(new Report(test.spec.name, updateReportFromStats(test.stats)))
    }
});