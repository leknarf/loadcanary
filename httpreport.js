var sys = require('sys');
var http = require('http');
var fs = require('fs');
var querystring = require('querystring');

var MAX_POINTS_PER_CHART = 80;
var chartids = 0;

function Report() {
    this.text = "";
    this.charts = {};
}
Report.prototype = {
    setText: function(text) {
        this.text = text;
    },
    addLine: function(text) {
        this.text += text + "\n";
    },
    addChart: function(name) {
        var chart = new Chart(name);
        if (this.charts[chart.name] != null)
            chart.name += "-1";
        this.charts[chart.name] = chart;
        return chart;
    }
}

function Chart(name) {
    this.name = name;
    this.uid = chartids++;
    this.data = {}
}
Chart.prototype = {
    put: function(data) {
        var time = new Date().getTime();
        for (item in data) {
            if (this.data[item] == null) {
                this.data[item] = [];
            }
            this.data[item].push([time, data[item]]);
        }
    }
}

function getFlotChart(data) {
    var chart = [];
    for (category in data) {
        var samples = sample(data[category], MAX_POINTS_PER_CHART);
        chart.push(getFlotObject(category, samples));
    }
    return chart;
}

function getFlotObject(label, data) {
    return {
        label: label,
        data: data,
    };
}

function sample(data, points) {
    if (data.length <= points)
        return data;
    
    var samples = [];
    for (var i = 0; i < data.length; i += Math.ceil(data.length / points)) {
        samples.push(data[i]);
    }
    if (data.length % points != 0) {
        samples.push(data[data.length-1]);
    }
    return samples;
}

function serveReport(report, response) {
    var chartdivs = "";
    var plotcharts = "";
    for (var i in report.charts) {
        var c = report.charts[i];
        var uid = report.charts[i].uid;
        chartdivs += '<h2>' + c.name + '</h2>' +
                     '<div id="chart' + uid + '" style="width:800px;height:400px;"></div>';
        plotcharts += '$.ajax({ url: "/data/' + querystring.escape(c.name) + '",' +
                     '      dataType: "json",' +
                     '      success: function(result) {' +
                     '          $.plot($("#chart' + uid + '"), result, options);' +
                     '      }' +
                     '});'
    }
    var now = new Date();
    var html = '<html><head><title>nodeload results: ' + now + '</title>' +
           '<script language="javascript" type="text/javascript" src="./flot/jquery.js"></script>' +
           '<script language="javascript" type="text/javascript" src="./flot/jquery.flot.js"></script>' +
           '</head><body><h1>Test Results from ' + now + '</h1><pre>' + report.text + '</pre>' +
           chartdivs +
           '<script id="source" language="javascript" type="text/javascript">' +
           '$(document).ready(function() {' +
           '    get_data();' +
           '    setInterval(get_data, 1000);' +
           '});' +
           'function get_data() {' +
           '    var options = {' +
           '      lines: {show: true},' +
           '      points: {show: true},' +
           '      legend: {position: "se", backgroundOpacity: 0},' +
           '      xaxis: { mode: "time", timeformat: "%H:%M:%S"},' +
           '    };' +
                plotcharts + 
           '}' +
           '</script>' +
           '</body></html>'

   response.sendHeader(200, {"Content-Type": "text/html"});
   response.sendBody(html);
   response.finish();
}

function serveChart(chart, response) {
    if (chart != null) {
        response.sendHeader(200, {"Content-Type": "text/json"});
        response.sendBody(JSON.stringify(getFlotChart(chart.data)));
        response.finish();
    } else {
        response.sendHeader(404, {"Content-Type": "text/html"});
        response.finish();
    }
    
}

function serveFile(file, response) {
    fs.stat(file).addCallback(function(stat) {
        if (stat.isFile()) {
            response.sendHeader(200, {
                'Content-Type': "text/javascript",
                'Content-Length': stat.size,
            });

            fs.open(file, process.O_RDONLY, 0666).addCallback(function (fd) {
                var pos = 0;
                function streamChunk () {
                    fs.read(fd, 16*1024, pos, "binary").addCallback(function (chunk, bytesRead) {
                        if (!chunk) {
                            fs.close(fd);
                            response.finish();
                            return;
                        }

                        response.sendBody(chunk, "binary");
                        pos += bytesRead;

                        streamChunk();
                    });
                }
                streamChunk();
            });                  
        } else  {
            response.sendHeader(404, {"Content-Type": "text/html"});
            response.finish();
        }
    }).addErrback(function (e) {
        response.sendHeader(404, {"Content-Type": "text/html"});
        response.finish();
    });
}

function startHttpServer(port, report) {
    if (report == null)
        report = httpReport;
    if (port == null)
        port = 8000;
    var server = http.createServer(function (req, res) {
        var now = new Date();
        if (req.url == "/") {
            serveReport(report, res);
        } else if (req.url.match("^/data/")) {
            serveChart(report.charts[querystring.unescape(req.url.substring(6))], res);
        } else {
            serveFile("." + req.url, res);
        }
    });
    server.listen(port);
    return server;
}

exports.httpReport = httpReport = new Report();
exports.startHttpServer = startHttpServer;