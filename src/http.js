// ------------------------------------
// HTTP Server
// ------------------------------------
//
// This file defines and starts the nodeload HTTP server. This following global variables may be defined
// before require()'ing this file to change the server's configuration:
//
// - DISABLE_HTTP_SERVER [false]: if true, do not start the HTTP server
// - HTTP_SERVER_PORT [8000]: the port the HTTP server listens on
// - SUMMARY_HTML_REFRESH_PERIOD [2]: number of seconds between auto-refresh of HTML summary page
// 
function getReportAsHtml(report) {
    var chartdivs = "";
    var plotcharts = "";
    for (var i in report.charts) {
        var c = report.charts[i];
        var uid = report.charts[i].uid;
        var chartdiv = 
            '<div class="post"><h2>' + c.name + '</h2>' +
            '<div class="entry" style="width:100%;float:left">' +
            '<div id="chart${id}" style="float:left;width:900px;height:200px;"></div>' +
            '<div id="chart${id}legend" style="float:left;width:124px;height:200px;"></div>' +
            '</div></div>';
        var plotchart = 
            'graph${id} = new Dygraph(' +
                'document.getElementById("chart${id}"),' + 
                JSON.stringify(c.rows) + ',' + 
                '{labelsDiv: document.getElementById("chart${id}legend"),' +
                ' labelsSeparateLines: true,' +
                ' labels: ' + JSON.stringify(c.columns) + 
                '});' +
            'if(navigator.appName == "Microsoft Internet Explorer") { http${id} = new ActiveXObject("Microsoft.XMLHTTP"); } else { http${id} = new XMLHttpRequest(); }' +
            'setInterval(function() { ' +
                'http${id}.open("GET", "/data/' + querystring.escape(report.name) + '/' + querystring.escape(c.name) + '");' +
                'http${id}.onreadystatechange=function() { if(http${id}.readyState == 4) { graph${id}.updateOptions({"file": JSON.parse(http${id}.responseText)});}};' +
                'http${id}.send(null);' +
            '}, ' + SUMMARY_HTML_REFRESH_PERIOD + ');';
        chartdivs += chartdiv.replace(/\$\{id\}/g, uid);
        plotcharts += plotchart.replace(/\$\{id\}/g, uid);
    }
    var now = new Date();
    var html = 
            '<html><head><title>Test Results</title> \
            <script language="javascript" type="text/javascript"><!--\n' +
            DYGRAPH_SOURCE +
            '\n--></script> \
            <style><!-- \
            body { margin: 0px; font: 13px Arial, Helvetica, sans-serif; } \
            h1 { font-size: 2.4em; } \
            p, ol, ul { line-height: 30%; } \
            a:hover { text-decoration: none; } \
            #header { width: 100%; height: 100px; margin: 0px auto; color: #FFFFFF; background: #699C4D; border: 3px solid darkgreen; border-style: none none solid none;} \
            #header h1 { width: 1024; padding: 25px 0px 0px 0px; margin: 0px auto; font-weight: normal; } \
            #header p { width: 1024; padding: 15px 0px 0px 0px; margin: 0px auto; } \
            #page { width: 1024px; margin: 0px auto; padding: 30px 0px; } \
            .post { margin: 0px 0px 30px 0px; } \
            .post h1, .post h2 { margin: 0px; padding: 0px 0px 5px 0px; border-bottom: #BFC9AE solid 1px; color: #232F01; } \
            .entry { margin: 10px 0px 20px 0px; } \
            #footer { clear: both; width: 1024px; height: 50px; margin: 0px auto 30px auto; color: #FFFFFF; background: #699C4D; } \
            #footer p { padding: 19px 0px 0px 0px; text-align: center; line-height: normal; font-size: smaller; } \
            #footer a { color: #FFFFFF; } \
            --></style> \
            </head> \
            <body> \n\
            <div id="header"><h1>Test Results</h1><p>' + now + '</p></div> \n\
            <div id="page"><div id="content"> \n\
               <div class="post"><h2>Summary</h2><div class="entry"> \n\
                   <p><pre id="reportText">' + report.text + '</pre></p> \n\
               </div></div>' +
               chartdivs +
            '</div></div> \n\
            <script id="source" language="javascript" type="text/javascript"> \n\
            if(navigator.appName == "Microsoft Internet Explorer") { http = new ActiveXObject("Microsoft.XMLHTTP"); } else { http = new XMLHttpRequest(); } \n\
            setInterval(function() { \n\
               http.open("GET", "/data/' + querystring.escape(report.name) + '/report-text"); \n\
               http.onreadystatechange=function() { if(http.readyState == 4 && http.status == 200) { document.getElementById("reportText").innerText = http.responseText }}; \n\
               http.send(null); \n\
            }, ' + SUMMARY_HTML_REFRESH_PERIOD + ');' +
            plotcharts +
            '</script> \n\
            <div id="footer"><p>generated with <a href="http://github.com/benschmaus/nodeload">nodeload</a></p></div> \n\
            </body></html>';

     return html;
}

function serveReport(report, response) {
    var html = getReportAsHtml(report);
    response.writeHead(200, {"Content-Type": "text/html", "Content-Length": html.length});
    response.write(html);
    response.end();
}

function serveChart(chart, response) {
    if (chart != null) {
        var data = JSON.stringify(chart.rows);
        response.writeHead(200, {"Content-Type": "text/csv", "Content-Length": data.length});
        response.write(data);
    } else {
        response.writeHead(404, {"Content-Type": "text/html", "Content-Length": 0});
        response.write("");
    }
    response.end();
}

function serveFile(file, response) {
    fs.stat(file, function(err, stat) {
        if (err == null) {
            if (stat.isFile()) {
                response.writeHead(200, {
                    'Content-Length': stat.size,
                });

                fs.open(file, process.O_RDONLY, 0666, function (err, fd) {
                    if (err == null) {
                        var pos = 0;
                        function streamChunk() {
                            fs.read(fd, 16*1024, pos, "binary", function(err, chunk, bytesRead) {
                                if (err == null) {
                                    if (!chunk) {
                                        fs.close(fd);
                                        response.end();
                                        return;
                                    }

                                    response.write(chunk, "binary");
                                    pos += bytesRead;

                                    streamChunk();
                                } else {
                                    response.writeHead(500, {"Content-Type": "text/plain"});
                                    response.write("Error reading file " + file);
                                    response.end();
                                }
                            });
                        }
                        streamChunk();
                    } else {
                        response.writeHead(500, {"Content-Type": "text/plain"});
                        response.write("Error opening file " + file);
                        response.end();
                    }
                });
            } else{
                response.writeHead(404, {"Content-Type": "text/plain"});
                response.write("Not a file: " + file);
                response.end();
            } 
        } else {
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.write("Cannot find file: " + file);
            response.end();
        }
    });
}

startHttpServer = function(port) {
    if (typeof HTTP_SERVER != "undefined")
        return;
        
    qputs('Serving progress report on port ' + port + '.');
    HTTP_SERVER = http.createServer(function (req, res) {
        var now = new Date();
        if (req.method == "GET" && req.url == "/") {
            serveReport(HTTP_REPORT, res);
        } else if (req.method == "GET" && req.url.match("^/data/main/report-text")) {
            res.writeHead(200, {"Content-Type": "text/plain", "Content-Length": HTTP_REPORT.text.length});
            res.write(HTTP_REPORT.text);
            res.end();
        } else if (req.method == "GET" && req.url.match("^/data/main/")) {
            serveChart(HTTP_REPORT.charts[querystring.unescape(req.url.substring(11))], res);
        } else if (req.method == "GET" && req.url.match("^/remote")) {
            serveRemote(req.url, req, res);
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


// Define and start HTTP server
if (typeof HTTP_REPORT == "undefined")
    HTTP_REPORT = new Report("main");

if (typeof HTTP_SERVER_PORT == "undefined") {
    HTTP_SERVER_PORT = 8000;
    if (process.env['HTTP_SERVER_PORT'] != null) {
        HTTP_SERVER_PORT = Number(process.env['HTTP_SERVER_PORT']);
    }
}
    
if (typeof DISABLE_HTTP_SERVER == "undefined" || DISABLE_HTTP_SERVER == false)
    startHttpServer(HTTP_SERVER_PORT);
