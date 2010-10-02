// ------------------------------------
// HTTP Server
// ------------------------------------
//
// This file defines and starts the nodeload HTTP server. This following global variables may be defined
// before require()'ing this file to change the server's configuration:
//
// - DISABLE_HTTP_SERVER [false]: if true, do not start the HTTP server
// - HTTP_SERVER_PORT [8000]: the port the HTTP server listens on
// 

startHttpServer = function(port) {
    if (typeof HTTP_SERVER != "undefined")
        return;
        
    qputs('Serving progress report on port ' + port + '.');
    HTTP_SERVER = http.createServer(function (req, res) {
        if (req.url == "/" || req.url.match("^/data/")) {
            serveReport(req.url, req, res)
        } else if (req.url.match("^/remote")) {
            serveRemote(req.url, req, res);
        } else if (req.method == "GET") {
            serveFile("." + req.url, res);
        } else {
            res.writeHead(405, {"Content-Length": "0"});
            res.end();
        }
    });
    HTTP_SERVER.listen(port);
}

stopHttpServer = function() {
    if (typeof HTTP_SERVER == "undefined")
        return;

    HTTP_SERVER.close();
    qputs('Shutdown report server.');
}

// =================
// Private methods
// =================

function serveFile(file, response) {
    fs.stat(file, function(err, stat) {
        if (err != null) {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("Cannot find file: " + file);
            response.end();
            return;
        }
        
        fs.readFile(file, "binary", function (err, data) {
            if (err == null) {
                response.writeHead(200, { 'Content-Length': data.length });
                response.write(data, "binary");
            } else {
                response.writeHead(500, {"Content-Type": "text/plain"});
                response.write("Error opening file " + file + ": " + err);
            }
            response.end();
        });
    });
}

// Define and start HTTP server
if (typeof HTTP_SERVER_PORT == "undefined") {
    HTTP_SERVER_PORT = 8000;
    if (process.env['HTTP_SERVER_PORT'] != null) {
        HTTP_SERVER_PORT = Number(process.env['HTTP_SERVER_PORT']);
    }
}
    
if (typeof DISABLE_HTTP_SERVER == "undefined" || DISABLE_HTTP_SERVER == false)
    startHttpServer(HTTP_SERVER_PORT);