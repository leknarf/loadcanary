// ------------------------------------
// HTTP Server
// ------------------------------------
//
// This file defines HTTP_SERVER.
//
// This file defines and starts the nodeload HTTP server.
// 

/** The global HTTP server. By default, HTTP_SERVER knows how to return static files from the current
directory. Add new routes to HTTP_SERVER.route_(). */
var HTTP_SERVER = exports.HTTP_SERVER = {
    server: null,
    
    start: function(port) {
        if (this.server) { return };
        
        var that = this;
        this.server = http.createServer(function(req, res) { that.route_(req, res) });
        this.server.listen(port);
        qputs('Started HTTP server on port ' + port + '.');
    },
    stop: function() {
        if (!this.server) { return };
        this.server.close();
        this.server = null;
        qputs('Shutdown HTTP server.');
    },
    route_: function(req, res) {
        if (req.url == "/" || req.url.match("^/data/")) {
            serveReport(req.url, req, res)
        } else if (req.url.match("^/remote")) {
            serveRemote(req.url, req, res);
        } else if (req.method == "GET") {
            this.serveFile_("." + req.url, res);
        } else {
            res.writeHead(405, {"Content-Length": "0"});
            res.end();
        }
    },
    serveFile_: function(file, response) {
        fs.stat(file, function(err, stat) {
            if (err != null) {
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
    }
}

// Start HTTP server
NODELOAD_CONFIG.on('apply', function() { 
    if (NODELOAD_CONFIG.HTTP_ENABLED) {
        HTTP_SERVER.start(NODELOAD_CONFIG.HTTP_PORT);
    }
});