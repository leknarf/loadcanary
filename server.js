var express = require('express');

var app = express();
app.configure(function(){
  app.use(express.static(__dirname + '/html'));
});

app.get('/request', function(req, res){
    var request = require('./doloadtest.js');
    res.send(request.run()); // try res.json() if result is an object or array
});
app.get('/getdata', function(req, res){
    var request = require('./monitor.js');
    res.json(request.run()); // try res.json() if result is an object or array
});

app.listen(process.env.PORT || 1337);
