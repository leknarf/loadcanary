#!/usr/bin/env node

var http = require('http'),
    remote = require('../lib/remote'),
    HTTP_SERVER = require('../lib/http').HTTP_SERVER,
    Cluster = remote.Cluster;

var cluster = new Cluster({
    master: {
        sendOutput: function(slaves, slaveId, output) {
            console.log('-------------' + slaveId + '-------------\n' + output + '--------------------------');
        }
    },
    slaves: {
        hosts: ['localhost:8001'],
        setup: function(master) {
            this.exec = require("child_process").exec;
        },
        exec: function(master, cmd) {
            var self = this;
            self.state = 'running';
            self.child = self.exec(cmd, function(error, stdout) {
                if (error === null) {
                    master.sendOutput(stdout.toString());
                    self.state = 'done';
                } else {
                    self.state = 'error';
                }
            });
        }
    }
});

HTTP_SERVER.on('start', function() {
    cluster.on('end', function(slaves) {
        console.log('All slaves finished: ' + 
            JSON.stringify(
                slaves.map(function(s) {
                    return s.id + ': ' + s.result;
                })));
    });
    cluster.on('start', function() {
        cluster.exec('ls -alh && sleep 3');
    });
    cluster.on('running', function() {
        console.log('All slaves running');
    });
    cluster.on('done', function() {
        console.log('All slaves done');
    });
    cluster.on('slaveState', function(slave, state) {
        if (state === 'error') {
            console.log('Slave "' + slave.id + '" encountered an error.');
        }
    });
    cluster.start();
});