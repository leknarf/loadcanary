var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var slave = require('./slave');
var Endpoint = require('./endpoint').Endpoint;
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
    pingInterval: 2000,
    server: HttpServer instance (defaults to global HTTP_SERVER)
}

Calling cluster.start() will register a master handler on the provided http.js#HttpServer. It will
connect to every slave, asking each slave to 1) execute the setup() function, 2) report its current
state to this host every pingInterval milliseconds. Calling cluster.slave_remote_function_1(), will
execute slave_remote_function_1 on every slave.

Cluster emits the following events:

- 'init': emitted when the cluster.start() can be called (the underlying HTTP server has been started).
- 'start': when connections to all the slave instances have been established
- 'end': when all the slaves have been terminated (e.g. by calling cluster.end()). The endpoint
    installed in the underlying HTTP server has been removed.
- 'running', 'done': when all the slaves report that they are in a 'running' or 'done' state. To set a
    slave's the state, install a slave function:
    
        cluster = new Cluster({ 
            slaves: {
                slave_remote_function: function(master) { this.state = 'running'; }
            },
            ...
        });
    
    and call it
    
        cluster.slave_remote_function();
        
Cluster.state can be:
- 'initializing': The cluster cannot be started yet -- it is waiting for the HTTP server to start.
- 'initialized': The cluster can be started.
- 'started': Connections to all the slaves have been established and the master endpoint is created.
- 'stopped': All of the slaves have been properly shutdown and the master endpoint removed.
*/
var Cluster = exports.Cluster = function Cluster(spec) {
    EventEmitter.call(this);
    
    var self = this,
        masterSpec = spec.master || {},
        slavesSpec = spec.slaves || { hosts:[] };
    
    self.server = spec.server || HTTP_SERVER;
    self.masterEndpoint = new Endpoint(self.server);
    self.slaves = new Slaves(self.masterEndpoint, spec.pingInterval);
    self.slaveState_ = {};

    // Define all master methods on the local endpoint
    self.masterEndpoint.setStaticParams([self.slaves]);
    self.masterEndpoint.defineMethod('updateSlaveState_', self.updateSlaveState_.bind(self));
    util.forEach(masterSpec, function(method, val) {
        self.masterEndpoint.defineMethod(method, val);
    });

    // Send all slave methods definitions to the remote instances
    slavesSpec.hosts.forEach(function(h) { self.slaves.add(h); });
    util.forEach(spec.slaves, function(method, val) {
        if (typeof val === 'function') {
            self.slaves.defineMethod(method, val);
            self[method] = function() { self.slaves[method].apply(self.slaves, arguments); };
        }
    });

    // Cluster is started when slaves are alive, and ends when slaves are all shutdown
    self.slaves.on('start', function() { 
        self.state = 'started';
        self.emit('start'); 
    });
    self.slaves.on('end', function() { 
        self.masterEndpoint.destroy();
        self.state = 'stopped';
        self.emit('end'); 
    });

    // Cluster is initialized (can be started) once server is started
    if (self.server.running) {
        self.state = 'initialized';
        process.nextTick(function() { self.emit('init'); });
    } else {
        self.state = 'initializing';
        self.server.on('start', function() {
            self.state = 'initialized';
            self.emit('init');
        });
    }
};
util.inherits(Cluster, EventEmitter);
/** Start cluster; install a route on the local HTTP server and send the slave definition to all the
slave instances. */
Cluster.prototype.start = function() {
    if (!this.server.running) { 
        throw new Error('A Cluster can only be started after it has emitted \'init\'.'); 
    }
    this.masterEndpoint.start();
    this.slaves.start();
    // this.slaves 'start' event handler emits 'start' and updates state
};
/** Stop the cluster; remove the route from the local HTTP server and uninstall and disconnect from all
the slave instances */
Cluster.prototype.end = function() {
    this.slaves.end();
    // this.slaves 'end' event handler emits 'end', destroys masterEndpoint & updates state
};
/** Receive a periodic state update message from a slave. When all slaves enter the 'running' or 'done'
states, emit an event. */
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