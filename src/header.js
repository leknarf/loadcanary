if (typeof _NODELOADLIB != "undefined") return;
_NODELOADLIB = 1

var sys = require('sys');
var http = require('http');
var fs = require('fs');
var events = require('events');
var querystring = require('querystring');

var START = new Date().getTime();
var lastUid = 0;
var uid = function() { return lastUid++ };

