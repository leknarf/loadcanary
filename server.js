process.on('uncaughtException', function (exception) {
	console.log(exception);
});

var express = require('express');

var app = express();
app.configure(function(){
  app.use(express.static(__dirname + '/html'));
});
app.use(express.bodyParser());

app.post('/request', function(req, res){
    var request = require('./doloadtest.js');
    var params = req.body;
    res.send(request.run(params)); // try res.json() if result is an object or array
});
app.get('/getdata', function(req, res){
    var request = require('./monitor.js');
    res.json(request.run()); // try res.json() if result is an object or array
});

app.listen(process.env.PORT || 1337);
