var sys = require('sys'), 
   http = require('http');
http.createServer(function (req, res) {
  var maxDelayMs = 10;
  var delay = Math.round(Math.random()*maxDelayMs);
  setTimeout(function () {
    res.sendHeader(200, {'Content-Type': 'text/plain'});
    res.sendBody(delay+'\n');
    res.finish();
  }, delay);
}).listen(8000);
sys.puts('Server running at http://127.0.0.1:8000/');
