/*
 Copyright (c) 2010 Benjamin Schmaus
 Copyright (c) 2010 Jonathan Lee

 Permission is hereby granted, free of charge, to any person
 obtaining a copy of this software and associated documentation
 files (the "Software"), to deal in the Software without
 restriction, including without limitation the rights to use,
 copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following
 conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 OTHER DEALINGS IN THE SOFTWARE.
*/

var sys = require('sys');

var echo = true;
var now = new Date().getTime();
var lastReport = now;
var reportName = 'results-chart-' + now + ".html";
var reportData = { "req/s": [[now,0]], average: [[now,0]], median: [[now,0]], "95%": [[now,0]], "99%": [[now,0]] };
var reportText = "";

function pad(str, width) {
    return str + (new Array(width-str.length)).join(" ");
}

function puts(s) {
    if (echo) {
        sys.puts(s);
    }
}

function printItem(name, val, padLength) {
    if (padLength == undefined)
        padLength = 40;

    var item = pad(name + ":", padLength) + " " + val;
    puts(item);
    reportText += item + "\n";
}

function addData(time, data) {
    for (category in data) {
        if (category in reportData) {
            reportData[category].push([time.getTime(), data[category]]);
        }
    }
}

exports.setEcho = function(echoOn) {
    echo = echoOn;
}

exports.progress = function(status) {

    var now = new Date();
    var summary;
    
    if (status.intervalStats.length > 0) {
        summary = {
            ts: now,
            ttlReqs: status.cumulativeStats.length,
            reqs: status.intervalStats.length,
            "req/s": (status.intervalStats.length/(now-lastReport)*1000).toFixed(1),
            min: status.intervalStats.min,
            average: status.intervalStats.mean().toFixed(1),
            median: status.intervalStats.percentile(.5),
            "95%": status.intervalStats.percentile(.95),
            "99%": status.intervalStats.percentile(.99),
            max: status.intervalStats.max
        };
    } else {
        summary = { ts: now, ttlReqs: status.cumulativeStats.length, reqs: 0, "req/s": 0, min: 0, average: 0, median: 0, "95%": 0, "99%": 0, max: 0 };
    }

    lastReport = now;
    addData(now, summary);
    puts(JSON.stringify(summary));
    writeHtmlReport(reportName, "", reportData);
}

exports.finish = function(results, options) {

    var elapsedSeconds = ((new Date()) - results.stats.start)/1000;

    puts('');
    printItem('Server', options.get('host') + ":" + options.get('port'));

    if (options.get('requestGeneratorModule') == null) {
        printItem('HTTP Method', options.get('method'))
        printItem('Document Path', options.get('path'))
    } else {
        printItem('Request Generator', options.get('requestGeneratorModule'));
    }

    printItem('Concurrency Level', options.get('numClients'));
    printItem('Number of requests', results.stats.length);
    printItem('Body bytes transferred', results.bytesTransferred);
    printItem('Elapsed time (s)', elapsedSeconds.toFixed(2));
    printItem('Requests per second', (results.stats.length/elapsedSeconds).toFixed(2));
    printItem('Mean time per request (ms)', results.stats.mean().toFixed(2));
    printItem('Time per request standard deviation', results.stats.stddev().toFixed(2));
    
    var tmp = '\nPercentages of requests served within a certain time (ms)';
    puts(tmp);
    reportText += tmp + '\n';
    printItem("  Min", results.stats.min, 6);
    printItem("  Avg", results.stats.mean().toFixed(1), 6);
    printItem("  50%", results.stats.percentile(.5), 6)
    printItem("  95%", results.stats.percentile(.95), 6)
    printItem("  99%", results.stats.percentile(.99), 6)
    printItem("  Max", results.stats.max, 6);
    
    writeHtmlReport(reportName, reportText, reportData);
}

function writeHtmlReport(fileName, reportText, reportData) {
    var fs = require("fs");
    var now = new Date();
    var latencyData = { average: reportData.average, median: reportData.median, "95%": reportData["95%"], "99%": reportData["99%"] };
    var latencyChart = JSON.stringify(getFlotChart(latencyData));
    var rpsData = { "req/s": reportData["req/s"] };
    var rpsChart = JSON.stringify(getFlotChart(rpsData));
    fs.open(
        fileName,
        process.O_WRONLY|process.O_CREAT,
        process.S_IRWXU|process.S_IRWXG|process.S_IROTH,
        function(err, fd) {
            fs.write(fd, 
                "<html><head><title>nodeload results: " + now + "</title>\n" +
                '<script language="javascript" type="text/javascript" src="./flot/jquery.js"></script>\n' +
                '<script language="javascript" type="text/javascript" src="./flot/jquery.flot.js"></script>\n' +
                '</head>\n<body>\n<h1>Test Results from ' + now + '</h1>\n<pre>' + reportText + '</pre>' +
                '<h2>Latency (ms) vs. Time</h2>\n' +
                '<div id="latency" style="width:800px;height:400px;"></div>\n' +
                '<h2>Requests Per Second vs. Time</h2>\n' +
                '<div id="rps" style="width:800px;height:400px;"></div>\n' +
                '<script id="latencyData" language="javascript" type="text/javascript">\n' +
                '$(function () { $.plot($("#latency"), ' + latencyChart + ', { xaxis: { mode: "time", timeformat: "%H:%M:%S"}, yaxis: {min: 0}, legend: {position: "se", backgroundOpacity: 0} }); });\n' +
                "</script>\n" +
                '<script id="rpsData" language="javascript" type="text/javascript">\n' +
                '$(function () { $.plot($("#rps"), ' + rpsChart + ', { xaxis: { mode: "time", timeformat: "%H:%M:%S"}, yaxis: {min: 0}, legend: {position: "se", backgroundOpacity: 0} }); });\n' +
                "</script>\n" +
                "</body></html>",
                null, "ascii", function(err, bytes) { fs.close(fd) });
        }
    );
}

function getFlotChart(data) {
    var chart = [];
    for (category in data) {
        var samples = sample(data[category], 80);
        chart.push(getFlotObject(category, samples));
    }
    return chart;
}

function getFlotObject(label, data) {
    return {
        label: label,
        data: data,
        points: {show: true}, lines: {show: true}
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
