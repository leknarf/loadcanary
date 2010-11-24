/*jslint sub: true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var EndpointClient = require('./endpoint').EndpointClient;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

// -------------------------
// Slave
// -------------------------
var Slave = exports.Slave = function Slave(id, host, port, masterEndpoint) {
    EventEmitter.call(this);
    this.id = id;
    this.client = new EndpointClient(host, port);
    this.masterEndpoint = masterEndpoint;
    this.methodDefs = [];
    this.state = 'stopped';
};
util.inherits(Slave, EventEmitter);
Slave.prototype.start = function() {
    var self = this;
    self.client.on('connect', function() {
        if (!self.basepath) {
            var req = self.client.rawRequest('POST', '/remote');
            req.end(JSON.stringify({ 
                id: self.id,
                master: self.masterEndpoint.url,
                masterMethods: self.masterEndpoint.methodNames,
                slaveMethods: self.methodDefs,
                updateInterval: NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS
            }));
            req.on('response', function(res) {
                self.client.basepath = url.parse(res.headers['location']).pathname;
                self.state = 'started';
                self.emit('start');
            });
        }
    });
    self.client.on('clientError', function(e) { self.emit('clientError', e); });
    self.client.start();
    self.state = 'connecting';
};
Slave.prototype.end = function() {
    var self = this, req = self.client.rawrequest('DELETE', self.client.basepath);
    req.end();
    req.on('response', function(res) {
        if (res.statusCode === 204) {
            self.client.end();
            self.client.basepath = '';
            self.state = 'stopped';
            self.emit('end');
        } else {
            self.emit('clientError', new Error('Error stopping slave.'), res);
        }
    });
};
Slave.prototype.defineMethod = function(name, fun) {
    var self = this;
    self.client.defineMethod(name, fun);
    self[name] = function() { return self.client[name].apply(self.client, arguments); };
    self.methodDefs.push({name: name, fun: fun.toString()});
};


// -------------------------
// Slaves
// -------------------------
var Slaves = exports.Slaves = function Slaves(masterEndpoint, pingInterval) {
    EventEmitter.call(this);
    this.masterEndpoint = masterEndpoint;
    this.slaves = [];
    this.pingInterval = pingInterval || NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
};
util.inherits(Slaves, EventEmitter);
Slaves.prototype.add = function(host, port) {
    var self = this, 
        id = host + ':' + port,
        slave = new Slave(id, host, port, self.masterEndpoint);

    self.slaves.push(slave);
    self[id] = slave;
    self[id].on('clientError', function(err) {
        self.emit('clientError', err, slave);
    });
    self[id].on('start', function() {
        util.forEach(self.slaves, function(id, s) {
            if (s.state !== 'started') { return; }
        });
        self.emit('start');
    });
    self[id].on('end', function() {
        util.forEach(self.slaves, function(id, s) {
            if (s.state !== 'stopped') { return; }
        });
        self.emit('end');
    });
};
Slaves.prototype.defineMethod = function(name, fun) {
    var self = this;

    self.slaves.forEach(function(slave) {
        slave.defineMethod(name, fun);
    });

    self[name] = function() {
        var args = arguments;
        return self.slaves.map(function(s) { return s[name].apply(s, args); });
    };
};
Slaves.prototype.start = function() {
    this.slaves.forEach(function(s) { s.start(); });
};
Slaves.prototype.end = function() {
    this.slaves.forEach(function(s) { s.end(); });
};