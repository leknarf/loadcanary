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

function printItem(name, val, padLength) {
    if (padLength == undefined)
        padLength = 40;
    sys.puts(pad(name + ":", padLength) + " " + val);
}

exports.print = function(results, options) {
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
    printItem('Median time per request (ms)', stats.median.toFixed(2));
    printItem('Mean time per request (ms)', stats.mean.toFixed(2));
    printItem('Time per request standard deviation', stats.deviation.toFixed(2));
    
    sys.puts('');
    sys.puts('Percentages of requests served within a certain time (ms)');
    printItem("  Min", stats.min, 6);
    printItem("  90%", stats.ninety, 6);
    printItem("  95%", stats.ninetyFive, 6);
    printItem("  99%", stats.ninetyNine, 6);
    printItem("  Max", stats.max, 6);
}


