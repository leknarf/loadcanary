// -----------------------------------------
// Header for single file build 
// -----------------------------------------

var util = require('util'),
    http = require('http'),
    fs = require('fs'),
    events = require('events'),
    querystring = require('querystring');

var EventEmitter = events.EventEmitter;

var START = new Date();
var BUILD_AS_SINGLE_FILE = true;
