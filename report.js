var sys = require('sys');

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
exports.pad = pad;

function printItem(name, val, padLength) {
    if (padLength == undefined)
        padLength = 40;
    sys.puts(pad(name + ":", padLength) + " " + val);
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
    
    sys.puts('');
    sys.puts('Percentages of requests served within a certain time (ms)');
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
                var idx = Math.round(rawResponseTimes.length * pct);
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
    var posix = require("posix");
    var fileName = 'results-chart-' + new Date().getTime() + ".html";
    posix.open(
        fileName,
        process.O_WRONLY|process.O_CREAT|process.O_APPEND,
        process.S_IRWXU|process.S_IRWXG|process.S_IROTH
    ).addCallback(
        function(fd) {
            write(posix, fd, "<html>\n<head><title>Response Times over Time</title>\n");
            write(posix, fd, '<script language="javascript" type="text/javascript" src="./flot/jquery.js"></script>\n');
            write(posix, fd, '<script language="javascript" type="text/javascript" src="./flot/jquery.flot.js"></script>\n');
            write(posix, fd, '</head>\n<body>\n\n');
            write(posix, fd, '<div id="placeholder" style="width:800px;height:400px;"></div>\n');
            write(posix, fd, '<script id="source" language="javascript" type="text/javascript">\n');
            write(posix, fd, '$(function () { $.plot($("#placeholder"), ' + flotData + ', { xaxis: { min: 0} }); });');
            write(posix, fd, "\n</script>\n</body>\n</html>\n");
            posix.close(fd);
        }
    );
    sys.puts("Wrote results to " + fileName);
}

function write(posix, fd, data) {
    posix.write(fd, data, null, "utf8").wait();
}

function getFlotObject(label, data) {
    return {
        label: label,
        data: data,
        points: {show: true}, lines: {show: true}
    };
}
