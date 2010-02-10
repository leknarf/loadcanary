var sys = require('sys');
var path = require('path');
require.paths.push(path.join(__dirname, 'optparse-js', 'src'));
var url = require('url');
var optparse = require('optparse');

// Default options
var testConfig = {
    url: '',
    method: 'GET',
    host: '',
    port: 80,
    numClients: 10,
    numRequests: 30,
    path: '/',
    reqPerClient: this.numClients / this.numRequests,
    requestGenerator: null
};
var switches = [
    [ '-n', '--number NUMBER', 'Number of requests to make' ],
    [ '-c', '--concurrency NUMBER', 'Concurrent number of connections' ],
    [ '-m', '--method STRING', 'HTTP method to use' ],
    [ '-q', '--quiet', 'Supress progress count info'],
    [ '-r', '--request-generator STRING', 'Path to module that defines makeRequest function'],
    [ '-u', '--usage', 'Show usage info' ],
];

// Create a new OptionParser.
var parser = new optparse.OptionParser(switches);
parser.on('usage', function() {
    sys.puts('azathoth.js [options] <host>:<port>/<path>');
    sys.puts(parser);
    process.exit();
});

parser.on(2, function (value) {
    if (value.search('^http://') == -1)
        value = 'http://' + value;

    testConfig.url = url.parse(value, false);
    testConfig.host = testConfig.url.hostname || testConfig.host;
    testConfig.port = Number(testConfig.url.port) || testConfig.port;
    testConfig.path = testConfig.url.pathname || testConfig.path;
});

parser.on(
    "quiet",
    function() {
        testConfig.quiet = true;
    }
);

parser.on('request-generator', function(opt, value) {
    var moduleName = value.substring(0, value.lastIndexOf('.'));
    testConfig.requestGeneratorModule = value;
    testConfig.requestGenerator = require(moduleName);
});

parser.on('concurrency', function(opt, value) {
    testConfig.numClients = Number(value);
});

parser.on('number', function(opt, value) {
    testConfig.numRequests = Number(value);
});

parser.on('method', function(opt, value) {
    testConfig.method = value;
});

exports.get = function(option) {
    return testConfig[option];
};
exports.process = function() {
    parser.parse(process.argv);
    if (testConfig.numRequests < testConfig.numClients) {
        sys.puts("Error: number of requests needs to be >= number of clients.");
        process.exit();
    }
};
