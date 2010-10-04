// ------------------------------------
// Progress Reporting
// ------------------------------------

function Report(name, updater) {
    this.name = name;
    this.uid = uid();
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

function Chart(name) {
    this.name = name;
    this.uid = uid();
    this.columns = ["time"];
    this.rows = [[timeFromTestStart()]];
}
Chart.prototype = {
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

writeHtmlSummary = function() {
    if (!DISABLE_LOGS) {
        fs.writeFile(SUMMARY_HTML, getReportsAsHtml(REPORT_MANAGER.reports), "ascii");
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
            if (stat.lastSummary) {
                if (stat.trend)
                    report.getChart(stat.name).put(stat.lastSummary.interval);
                for (var i in stat.lastSummary.cumulative) 
                    report.summary[stat.name + " " + i] = stat.lastSummary.cumulative[i];
            }
        }
    }
}

function getReportsAsHtml(reports) {
    var t = template.create(REPORT_SUMMARY_TEMPLATE);
    return t({querystring: querystring, reports: reports});
}

function getChartAsJson(chart) {
    return (chart == null) ? null : JSON.stringify(chart.rows);
}

/** Handler for all the requests to / and /data/main. See http.js#startHttpServer(). */
function serveReport(url, req, res) {
    if (req.method == "GET" && url == "/") {
        var html = getReportsAsHtml(REPORT_MANAGER.reports);
        res.writeHead(200, {"Content-Type": "text/html", "Content-Length": html.length});
        res.write(html);
    } else if (req.method == "GET" && req.url.match("^/data/([^/]+)/([^/]+)")) {
        var urlparts = querystring.unescape(req.url).split("/");
        var retobj = null;
        var report = REPORT_MANAGER.reports[urlparts[2]];
        if (report != null) {
            var chartname = urlparts[3];
            if (chartname == "summary") {
                retobj = report.summary;
            } else if (report.charts[chartname] != null) {
                retobj = report.charts[chartname].rows;
            }
        }
        if (retobj != null) {
            var json = JSON.stringify(retobj);
            res.writeHead(200, {"Content-Type": "application/json", "Content-Length": json.length});
            res.write(json);
        } else {
            res.writeHead(404, {"Content-Type": "text/html", "Content-Length": 0});
        }
    } else {
        res.writeHead(405, {"Content-Length": 0});
    }
    res.end();
}

// The global report manager that keeps reports up to date during a load test
var REPORT_MANAGER = {
    reports: {},
    addReport: function(report) {
        this.reports[report.name] = report;
    },
    updateReports: function() {
        for (var r in this.reports) {
            this.reports[r].update();
        }
        writeHtmlSummary();
    },
    reset: function() {
        this.reports = {};
    }
}
TEST_MONITOR.on('update', function() { REPORT_MANAGER.updateReports() });
TEST_MONITOR.on('end', function() { 
    for (var r in REPORT_MANAGER.reports) {
        REPORT_MANAGER.reports[r].updater = null;
    }
});
TEST_MONITOR.on('test', function(test) { 
    // when a new test is created, add a report that contains all the test stats
    if (test.stats) 
        REPORT_MANAGER.addReport(new Report(test.spec.name, updateReportFromStats(test.stats)))
});

if (typeof SUMMARY_HTML_REFRESH_PERIOD == "undefined") {
    SUMMARY_HTML_REFRESH_PERIOD = 2000;
}