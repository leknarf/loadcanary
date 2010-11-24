var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var slave = require('./slave');
var endpoint = require('./endpoint');
var Endpoint = endpoint.Endpoint;
var EventEmitter = require('events').EventEmitter;
var SlaveNode = require('./slavenode').SlaveNode;
var Slaves = slave.Slaves;
var qputs = util.qputs;
var HTTP_SERVER = require('../http').HTTP_SERVER;
var NODELOAD_CONFIG = require('../config').NODELOAD_CONFIG;
}

/** Main interface for creating a distributed nodeload cluster. Spec:
{ 
    master: {
        master_remote_function_1: function(slaves, slaveId, args...) { ... },
    },
    slaves: {
        host: ['host:port', ...],
        setup: function(master) { ... }
        slave_remote_function_1: function(master, args...) { ... }
    },
    pingInterval: 2000
}

Calling cluster.start() will register a master handler on this host. It will connect to every slave,
asking each slave to 1) execute the setup() function, 2) report its current status this host every
pingInterval milliseconds. Calling cluster.slave_remote_function_1(), will execute 
slave_remote_function_1 on every slave.

Within master_remote_function_1 and slave_remote_function_1, this points at an initially empty object
that should be used to store state.

*/
var Cluster = exports.Cluster = function Cluster(spec) {
    EventEmitter.call(this);
    
    var self = this,
        masterSpec = spec.master || {},
        slavesSpec = spec.slaves || { hosts:[] };
    
    self.masterEndpoint = new Endpoint(HTTP_SERVER);
    self.slaves = new Slaves(self.masterEndpoint, spec.pingInterval);
    self.slaveState_ = {};

    self.masterEndpoint.setStaticParams([self.slaves]);
    self.masterEndpoint.defineMethod('updateSlaveState_', self.updateSlaveState_.bind(self));
    util.forEach(masterSpec, function(method, val) {
        self.masterEndpoint.defineMethod(method, val);
    });

    slavesSpec.hosts.forEach(function(h) { 
        var parts = h.split(':'), host = parts[0], port = Number(parts[1]) || 8000;
        self.slaves.add(host, port);
    });
    util.forEach(spec.slaves, function(method, val) {
        if (typeof val === 'function') {
            self.slaves.defineMethod(method, val);
            self[method] = function() { self.slaves[method].apply(self.slaves, arguments); };
        }
    });
    
    self.state = 'initialized';
    self.slaves.on('start', function() { 
        self.state = 'started';
        self.emit('start'); 
    });
};
util.inherits(Cluster, EventEmitter);
Cluster.prototype.start = function() {
    if (!HTTP_SERVER.running) { 
        throw new Error('A Cluster can only be started after the global HTTP_SERVER is running.'); 
    }
    var self = this;
    self.masterEndpoint.start();
    self.slaves.start();
};
Cluster.prototype.end = function() {
    this.masterEndpoint.destroy();
    this.slaves.end();
    this.state = 'stopped';
    this.emit('end');
};
Cluster.prototype.updateSlaveState_ = function(slaves, slaveId, state) {
    var slave = slaves[slaveId];
    if (slave) {
        var previousState = this.slaveState_[slaveId];
        this.slaveState_[slaveId] = state;
        if (previousState !== state) {
            this.emit('slaveState', slave, state);

            if (state === 'running' || state === 'done') {
                this.emitWhenAllSlavesInState_(state); 
            }
        }
    } else {
        qputs('WARN: ignoring message from unexpected slave instance ' + slaveId);
    }
};
Cluster.prototype.emitWhenAllSlavesInState_ = function(state) {
    var allSlavesInSameState = true;
    util.forEach(this.slaveState, function(id, s) {
        if (s !== state) {
            allSlavesInSameState = false;
        }
    });
    if (allSlavesInSameState) {
        this.emit(state);
    }
};