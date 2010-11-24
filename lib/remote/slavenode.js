var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var url = require('url');
var util = require('../util');
var endpoint = require('./endpoint');
var Endpoint = endpoint.Endpoint;
var EndpointClient = endpoint.EndpointClient;
var EventEmitter = require('events').EventEmitter;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** An instance of SlaveNode is instantiated on each slave node in the Cluster. When a Slave object is
started, it sends a slave specification to the target machine. This specification is used to create 
SlaveNode. It contains:

    {
        id: master assigned id of this node,
        master: 'base url of master endpoint, e.g. /remote/0',
        masterMethods: ['list of method name supported by master'],
        slaveMethods: [
            { name: 'method-name', fun: 'function() { valid Javascript in a string }' }
        ],
        updateInterval: milliseconds between sending the current execution state to master
    }

If the any of the slaveMethods contain invalid Javascript, this constructor will throw an exception.
*/
var SlaveNode = exports.SlaveNode = function SlaveNode(server, spec) {
    EventEmitter.call(this);
    util.PeriodicUpdater.call(this);

    this.id = spec.id;

    var endpoint = this.createEndpoint_(server, spec.slaveMethods),
        masterClient = spec.master ? this.createMasterClient_(spec.master, spec.masterMethods) : null;

    this.url = endpoint.url;
    this.masterClient_ = masterClient;
    this.masterClient_.start();
    this.slaveEndpoint_ = endpoint;
    this.slaveEndpoint_.context.state = 'initialized';
    this.slaveEndpoint_.setStaticParams([this.masterClient_]);
    this.slaveEndpoint_.start();
    this.slaveEndpoint_.on('end', this.end.bind(this));
    this.updateInterval = (spec.updateInterval >= 0) ? spec.updateInterval : NODELOAD_CONFIG.SLAVE_UPDATE_INTERVAL_MS;
};
util.inherits(SlaveNode, EventEmitter);
SlaveNode.prototype.end = function() {
    if (this.slaveEndpoint_.state === 'started') {
        this.slaveEndpoint_.destroy();
    }
    if (this.masterClient_.state === 'connected' || this.masterClient_.state === 'reconnect') {
        this.masterClient_.end();
    }
    this.emit('end');
};
SlaveNode.prototype.update = function() {
    if (this.masterClient_ && this.masterClient_.state === 'connected') {
        this.masterClient_.updateSlaveState_(this.slaveEndpoint_.context.state);
    }
};
SlaveNode.prototype.createEndpoint_ = function(server, methods) {
    // Add a new endpoint and route to the HttpServer
    var endpoint = new Endpoint(server);
    
    // "Compile" the methods by eval()'ing the string in "fun", and add to the endpoint
    if (methods) {
        try {
            methods.forEach(function(m) {
                var fun;
                eval('fun=' + m.fun);
                endpoint.defineMethod(m.name, fun);
            });
        } catch (e) {
            endpoint.destroy();
            endpoint = null;
            throw e;
        }
    }
    
    return endpoint;
};
SlaveNode.prototype.createMasterClient_ = function(masterUrl, methods) {
    var parts = url.parse(masterUrl),
        masterClient = new EndpointClient(parts.hostname, Number(parts.port) || 8000, parts.pathname);

    masterClient.defineMethod('updateSlaveState_');
    if (methods && methods instanceof Array) {
        methods.forEach(function(m) { masterClient.defineMethod(m); });
    }

    masterClient.setStaticParams([this.id]);
    
    return masterClient;
};