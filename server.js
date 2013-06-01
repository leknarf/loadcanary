var coffee = require('coffee-script');
var app = require('./app.coffee');
var port = process.env.PORT || 1337

app.application.listen(port);
