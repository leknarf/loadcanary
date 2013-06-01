//var coffee = require('coffee-script');
//var app = require('./app.coffee');
//var port = process.env.PORT || 1337

var express = require('express');
var app = express();
app.configure(function(){
  //server.use('/media', express.static(__dirname + '/media'));
  app.use(express.static(__dirname + '/html'));
});
app.listen(80);

// app.application.listen(port);
