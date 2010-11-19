// ------------------------------------
// HTTP Server
// ------------------------------------
//
// This file defines HttpServer and the singleton HTTP_SERVER.
//
// This file defines a generic HTTP server that serves static files and that can be configured
// with new routes. It also starts the nodeload HTTP server unless require('nodeload/config')
// .disableServer() was called.
// 
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var config = require('./config');
var http = require('http');
var fs = require('fs');
var util = require('./util');
var qputs = util.qputs;
var NODELOAD_CONFIG = config.NODELOAD_CONFIG;
}

/** By default, HttpServer knows how to return static files from the current directory. Add new route 
regexs using HttpServer.on(). */
var HttpServer = exports.HttpServer = function HttpServer() {
    this.routes = [];
    this.running = false;
};
/** Start the server listening on the given port */
HttpServer.prototype.start = function(port, hostname) {
    if (this.running) { return; }
    this.running = true;

    var self = this;
    port = port || 8000;
    self.server = http.createServer(function(req, res) { self.route_(req, res); });
    self.server.listen(port, hostname);
    qputs('Started HTTP server on port ' + port + '.');
    return self;
};
/** Terminate the server */
HttpServer.prototype.stop = function() {
    if (!this.running) { return; }
    this.running = false;
    this.server.close();
    this.server = null;
    qputs('Shutdown HTTP server.');
};
/** When an incoming request matches a given regex, route it to the provided handler:
function(url, ServerRequest, ServerResponse) */
HttpServer.prototype.addRoute = function(regex, handler) {
    this.routes.push({regex: regex, handler: handler});
    return this;
};
HttpServer.prototype.route_ = function(req, res) {
    this.routes.forEach(function(r) {
        if (req.url.match(r.regex)) {
            r.handler(req.url, req, res);
            return;
        }
    });
    if (req.method === 'GET') {
        this.serveFile_('.' + req.url, res);
    } else {
        res.writeHead(405, {"Content-Length": "0"});
        res.end();
    }
};
HttpServer.prototype.serveFile_ = function(file, response) {
    fs.stat(file, function(err, stat) {
        if (err) {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("Cannot find file: " + file);
            response.end();
            return;
        }

        fs.readFile(file, "binary", function (err, data) {
            if (err) {
                response.writeHead(500, {"Content-Type": "text/plain"});
                response.write("Error opening file " + file + ": " + err);
            } else {
                response.writeHead(200, { 'Content-Length': data.length });
                response.write(data, "binary");
            }
            response.end();
        });
    });
};

// =================
// Singletons
// =================

/** The global HTTP server used by nodeload */
var HTTP_SERVER = exports.HTTP_SERVER = new HttpServer();
NODELOAD_CONFIG.on('apply', function() { 
    if (NODELOAD_CONFIG.HTTP_ENABLED) {
        HTTP_SERVER.start(NODELOAD_CONFIG.HTTP_PORT);
    }
});