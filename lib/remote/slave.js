/*jslint sub: true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var EndpointClient = require('./endpointclient').EndpointClient;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** Slave represents a remote slave instance from the master server's perspective. It holds the slave
method defintions, defined by calling defineMethod(), as Javascript strings. When start() is called,
the definitions are POSTed to /remote on the remote instance which causes the instance to create a new
endpoint with those methods. Subsequent calls to Slave simply POST parameters to the remote instance:

    slave = new Slave(...);
    slave.defineMethod('slave_method_1', function(master, name) { return 'hello ' + name });
    slave.start();
    slave.on('start', function() {
        slave.method_1('tom');
        slave.end();
    });

will POST the definition of method_1 to /remote, followed by ['tom'] to /remote/.../method_1.

Slave emits the following events:
- 'clientError', error: The underlying HTTP connection returned an error. The connection will be retried.
- 'start': The remote instance accepted the slave definition and slave methods can now be called.
- 'stopped': The slave endpoint has been removed from the remote instance.

Slave.state can be:
- 'initialized': The slave is ready to be started.
- 'connecting': The slave definition is being sent to the remote instance.
- 'started': The remote instance is running and methods defined through defineMethod can be called. */
var Slave = exports.Slave = function Slave(id, host, port, masterEndpoint) {
    EventEmitter.call(this);
    this.id = id;
    this.client = new EndpointClient(host, port);
    this.client.on('clientError', this.emit.bind(this, 'clientError'));
    this.masterEndpoint = masterEndpoint;
    this.methodDefs = [];
    this.state = 'initialized';
};
util.inherits(Slave, EventEmitter);
/** POST method definitions and information about this instance (the slave's master) to /remote */
Slave.prototype.start = function() {
    if (!this.basepath) {
        var self = this,
            req = self.client.rawRequest('POST', '/remote');

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
        
        self.state = 'connecting';
    }
};
/** Stop this slave by sending a DELETE request to terminate the slave's endpoint. */
Slave.prototype.end = function() {
    var self = this, req = self.client.rawRequest('DELETE', self.client.basepath);
    req.end();
    req.on('response', function(res) {
        if (res.statusCode !== 204) {
            self.emit('clientError', new Error('Error stopping slave.'), res);
        }

        self.client.destroy();
        self.client.basepath = '';
        self.state = 'initialized';
        self.emit('end');
    });
};
/** Define a method that will be sent to the slave instance */
Slave.prototype.defineMethod = function(name, fun) {
    var self = this;
    self.client.defineMethod(name, fun);
    self[name] = function() { return self.client[name].apply(self.client, arguments); };
    self.methodDefs.push({name: name, fun: fun.toString()});
};


/** A small wrapper for a collection of Slave instances. The instances are all started and stopped 
together and method calls are sent to all the instances.

Slaves emits the following events:
- 'clientError', error, slave: The underlying HTTP connection for this slave returned an error. The
    connection will be retried.
- 'start': All of the slave instances are running.
- 'stopped': All of the slave instances have been stopped. */

var Slaves = exports.Slaves = function Slaves(masterEndpoint, pingInterval) {
    EventEmitter.call(this);
    this.masterEndpoint = masterEndpoint;
    this.slaves = [];
    this.pingInterval = pingInterval || NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
};
util.inherits(Slaves, EventEmitter);
/** Add a remote instance in the format 'host:port' as a slave in this collection */
Slaves.prototype.add = function(hostAndPort) {
    var self = this, 
        parts = hostAndPort.split(':'), 
        host = parts[0],
        port = Number(parts[1]) || 8000,
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
/** Define a method on all the slaves */
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
/** Start all the slaves */
Slaves.prototype.start = function() {
    this.slaves.forEach(function(s) { s.start(); });
};
/** Terminate all the slaves */
Slaves.prototype.end = function() {
    this.slaves.forEach(function(s) { s.end(); });
};