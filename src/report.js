// ------------------------------------
// Progress Reporting
// ------------------------------------
var progressSummaryEnabled = false;

function defaultProgressReport(stats) {
    var out = '{"ts": ' + JSON.stringify(new Date());
    for (var i in stats) {
        var stat = stats[i];
        var summary = stat.interval.summary();
        out += ', "' + stat.name + '": '
        if (stat.interval.length > 0) {
            out += JSON.stringify(summary);
        }
        if (HTTP_REPORT.charts[stat.name] != null) {
            HTTP_REPORT.charts[stat.name].put(summary);
        }
        stats[i].next();
    }
    out += "}";
    STATS_LOG.put(out + ",");
    qprint('.');

    if (progressSummaryEnabled) {
        summaryReport(summaryStats);
    } else {
        writeReport();
    }
}

function summaryReport(statsList) {
    function pad(str, width) {
        return str + (new Array(width-str.length)).join(" ");
    }
    var out = pad("  Test Duration:", 20) + ((new Date() - START)/60000).toFixed(1) + " minutes\n";
    
    // statsList is a list of maps: [{'name': Reportable, ...}, ...]
    for (var s in statsList) {
        var stats = statsList[s];
        for (var i in stats) {
            var stat = stats[i];
            var summary = stat.cumulative.summary();
            out += "\n" +
                   "  " + stat.name + "\n" +
                   "  " + (new Array(stat.name.length+1)).join("-") + "\n";
            for (var j in summary) {
                out += pad("    " + j + ":", 20)  + summary[j] + "\n";
            }
        }
    }
    HTTP_REPORT.setText(out);
    writeReport();
}

function Report(name) {
    this.name = name;
    this.clear();
}
Report.prototype = {
    setText: function(text) {
        this.text = text;
    },
    puts: function(text) {
        this.text += text + "\n";
    },
    addChart: function(name) {
        var chart = new Chart(name);
        if (this.charts[chart.name] != null)
            chart.name += "-1";
        this.charts[chart.name] = chart;
        return chart;
    },
    removeChart: function(name) {
        delete this.charts[name];
    },
    clear: function() {
        this.text = "";
        this.charts = {};
    }
}

function Chart(name) {
    this.name = name;
    this.uid = uid();
    this.columns = ["time"];
    this.rows = [[0]];
}
Chart.prototype = {
    put: function(data) {
        var row = [Math.floor((new Date().getTime() - START) / 600) / 100]; // 100ths of a minute
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

addReportStat = function(stat) {
    summaryStats.push([stat])
}

enableReportSummaryOnProgress = function(enabled) {
    progressSummaryEnabled = enabled;
}

writeReport = function() {
    if (!DISABLE_LOGS) {
        fs.writeFile(SUMMARY_HTML, getReportAsHtml(HTTP_REPORT), "ascii");
    }
}

