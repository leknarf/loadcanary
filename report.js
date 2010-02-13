/*
 Copyright (c) 2010 Orlando Vazquez
 Copyright (c) 2010 Benjamin Schmaus

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

var reportText = "";

function calcStats(responseTimes) {
    responseTimes.sort(function(a, b) { return a - b });
    var l = responseTimes.length
    var mean = responseTimes.reduce(function (a, b) { return a + b }) / l;

    var s = 0;
    responseTimes.forEach(function (val) {
        s += Math.pow(val - mean, 2);
    });
    var variance = s / l;
    var deviation = Math.sqrt(variance);


    var percentile = function(percent) {
        var t = responseTimes[Math.floor(responseTimes.length*percent)];
        return t;
    };
    var min = responseTimes[0];
    var max = responseTimes[responseTimes.length-1];


    return {
        variance: variance,
        mean: mean,
        deviation: deviation,
        min: min,
        max: max,
        median: percentile(0.5),
        ninety: percentile(0.9), ninetyFive: percentile(0.95), ninetyNine: percentile(0.99)
    };
}

function pad(str, width) {
    return str + (new Array(width-str.length)).join(" ");
}

exports.progress = function(requestsSoFar, targetNumRequests) {
    if (((requestsSoFar % (targetNumRequests/10)) == 0) || ((requestsSoFar % 150) == 0)) {
        sys.puts(pad('Completed ' +requestsSoFar+ ' requests', 40));
    }

}

function printItem(name, val, padLength) {
    if (padLength == undefined)
        padLength = 40;

    var reportData = pad(name + ":", padLength) + " " + val;
    sys.puts(reportData);
    reportText += reportData + "\n";
}

exports.print = function(results, options) {
    rawResponseTimes = results.responseTimes.slice(0);

    var stats = calcStats(results.responseTimes);
    if (!options.get('quiet')) {
        sys.puts('');
    }
    printItem('Server Hostname', options.get('host'));
    printItem('Server Port', options.get('port'))

    if (options.get('requestGeneratorModule') == null) {
        printItem('HTTP Method', options.get('method'))
        printItem('Document Path', options.get('path'))
    } else {
        printItem('Request Generator', options.get('requestGeneratorModule'));
    }

    printItem('Concurrency Level', options.get('numClients'));
    printItem('Number of requests', results.responseTimes.length);
    printItem('Body bytes transferred', results.bytesTransferred);
    printItem('Elapsed time (s)', (results.elapsedTime/1000).toFixed(2));
    printItem('Requests per second', (results.responseTimes.length/(results.elapsedTime/1000)).toFixed(2));
    printItem('Mean time per request (ms)', stats.mean.toFixed(2));
    printItem('Time per request standard deviation', stats.deviation.toFixed(2));
    
    var tmp = '\nPercentages of requests served within a certain time (ms)';
    sys.puts(tmp);
    reportText += tmp + '\n';
    printItem("  Min", stats.min, 6);
    printItem("  50%", stats.median, 6)
    printItem("  90%", stats.ninety, 6);
    printItem("  95%", stats.ninetyFive, 6);
    printItem("  99%", stats.ninetyNine, 6);
    printItem("  Max", stats.max, 6);

    if (options.get('flotChart')) {
        sys.puts('');
        sys.print('Generating Flot HTML chart.');
        var categories = { mean: [], median: [], ninety: [], ninetyFive: [], ninetyNine: [] };
        var chartData = [];
        for (cat in categories) {
            //sys.puts(cat + ": " + categories[cat].length);
            for (var i = 10; i <= 100; i += 10) {
                var pct = i / 100;
                var idx = Math.ceil(rawResponseTimes.length * pct);
                var responseTimes = rawResponseTimes.slice(0, idx);
                var stats = calcStats(responseTimes);
                categories[cat].push([idx, stats[cat].toFixed(2)]);
                //sys.print(stats[cat].toFixed(2) + " ");
            }
            sys.print('.');
            //sys.puts('');
            chartData.push(getFlotObject(cat, categories[cat]));
        }
        sys.puts('');
        writeHtmlReport(JSON.stringify(chartData));
    }
}

function writeHtmlReport(flotData) {
    var fs = require("fs");
    var now = new Date();
    var fileName = 'results-chart-' + now.getTime() + ".html";
    fs.open(
        fileName,
        process.O_WRONLY|process.O_CREAT|process.O_APPEND,
        process.S_IRWXU|process.S_IRWXG|process.S_IROTH
    ).addCallback(
        function(fd) {
            write(fs, fd, "<html>\n<head><title>Response Times over Time</title>\n");
            write(fs, fd, '<script language="javascript" type="text/javascript" src="./flot/jquery.js"></script>\n');
            write(fs, fd, '<script language="javascript" type="text/javascript" src="./flot/jquery.flot.js"></script>\n');
            write(fs, fd, '</head>\n<body>\n<h1>Test Results from ' + now + '</h1>\n<pre>' + reportText + '</pre>');
            write(fs, fd, '<h2>x = number of requests, y = response times (ms)</h2>\n');
            write(fs, fd, '<div id="placeholder" style="width:800px;height:400px;"></div>\n');
            write(fs, fd, '<script id="source" language="javascript" type="text/javascript">\n');
            write(fs, fd, '$(function () { $.plot($("#placeholder"), ' + flotData + ', { xaxis: { min: 0}, yaxis: {min: 0}, legend: {position: "sw", backgroundOpacity: 0} }); });');
            write(fs, fd, "\n</script>\n</body>\n</html>\n");
            fs.close(fd);
        }
    );
    sys.puts("Wrote results to " + fileName);
}

function write(fs, fd, data) {
    fs.write(fd, data, null, "ascii").wait();
}

function getFlotObject(label, data) {
    return {
        label: label,
        data: data,
        points: {show: true}, lines: {show: true}
    };
}
