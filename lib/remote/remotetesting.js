var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var run = require('../loadtesting').run;
var Cluster = require('./cluster').Cluster;
var EventEmitter = require('events').EventEmitter;
var qputs = util.qputs;
}

var LoadTestCluster = exports.LoadTestCluster = function LoadTestCluster(masterHost, slaveHosts, masterHttpServer, slaveUpdateInterval) {
    EventEmitter.call(this);

    var self = this;
    self.cluster = new Cluster({
        master: {
            host: masterHost,
            sendStats: function(slaves, slaveId, stats) {
            }
        },
        slaves: {
            hosts: slaveHosts,
            setup: function() {
                if (typeof BUILD_AS_SINGLE_FILE === 'undefined' || BUILD_AS_SINGLE_FILE === false) {
                    this.nlrun = require('../loadtesting').run;
                } else {
                    this.nlrun = run;
                }
            },
            runTests: function(master, specsStr) {
                var specs;
                try {
                    eval('specs='+specsStr);
                } catch(e) {
                    qputs('WARN: Ignoring invalid remote test specifications: ' + specsStr + ' - ' + e.toString());
                    return;
                }

                if (this.state === 'running') { 
                    qputs('WARN: Already running -- ignoring new test specifications: ' + specsStr);
                    return;
                }

                qputs('Received remote test specifications: ' + specsStr);

                var self = this,
                    loadtest = self.nlrun(specs);

                self.state = 'running';
                loadtest.keepAlive = true;
                loadtest.on('update', function(interval, stats) {
                    master.sendStats(interval);
                });
                loadtest.on('end', function() {
                    self.state = 'done';
                });
            }
        },
        server: masterHttpServer,
        pingInterval: slaveUpdateInterval
    });
    self.specs = [];
    self.slaveUpdateInterval = slaveUpdateInterval;
    self.cluster.on('init', function() {
        self.cluster.on('start', function() {
            if (self.specs.length > 0) {
                self.cluster.runTests(self.stringify(self.specs));
            }
        });
        self.cluster.start();
    });
    self.cluster.on('done', function() {
        self.emit('done');
    });
    self.cluster.on('end', function() {
        self.emit('end');
    });
};
util.inherits(LoadTestCluster, EventEmitter);
LoadTestCluster.prototype.run = function(specs) {
    specs = (specs instanceof Array) ? specs : util.argarray(arguments);
    this.specs = this.specs.concat(specs);
    if (this.specs.length > 0 && this.cluster.started()) {
        this.cluster.runTests(this.stringify(specs));
    }
};
LoadTestCluster.prototype.destroy = function() {
    this.cluster.end();
};
LoadTestCluster.prototype.stringify = function(obj) {
    switch (typeof obj) {
    case 'function':
        return obj.toString();
    case 'object':
        if (obj instanceof Array) {
            var self = this;
            return ['[', obj.map(function(x) { return self.stringify(x); }), ']'].join('');
        } else if (obj === null) {
            return 'null';
        }
        var ret = ['{'];
        for (var i in obj) {
            ret.push(i + ':' + this.stringify(obj[i]) + ',');
        }
        ret.push('}');
        return ret.join('');
    case 'number':
        if (isFinite(obj)) {
            return String(obj);
        }
        return 'Infinity';
    default:
        return JSON.stringify(obj);
    }
};