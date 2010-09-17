// -----------------------------------------
// Distributed testing
// -----------------------------------------
var SLAVE_CONFIG = null;
var WORKER_POOL = null;
var SLAVE_PING_PERIOD = 3000;

remoteTest = function(spec) {
    return "(function() {\n" +
            "  var remoteSpec = JSON.parse('" + JSON.stringify(spec) + "');\n" +
            "  remoteSpec.requestGenerator = " + spec.requestGenerator + ";\n" +
            "  remoteSpec.requestLoop = " + spec.requestLoop + ";\n" +
            "  remoteSpec.reportFun = " + spec.reportFun + ";\n" +
            "  addTest(remoteSpec);\n" +
            "})();\n";
}

remoteStart = function(master, slaves, tests, callback, stayAliveAfterDone) {
    var remoteFun = "";
    for (var i in tests) {
        remoteFun += tests[i];
    }
    remoteFun += "startTests();\n";
    remoteSubmit(master, slaves, remoteFun, callback, stayAliveAfterDone);
}

remoteStartFile = function(master, slaves, filename, callback, stayAliveAfterDone) {
    fs.readFile(filename, function (err, data) {
        if (err != null) throw err;
        data = data.replace(/^#![^\n]+\n/, '// removed shebang directive from runnable script\n');
        remoteSubmit(master, slaves, data, callback, stayAliveAfterDone);
    });
}

function remoteSubmit(master, slaves, fun, callback, stayAliveAfterDone) {
    WORKER_POOL = new RemoteWorkerPool(master, slaves);
    WORKER_POOL.fun = fun;
    WORKER_POOL.start(callback, stayAliveAfterDone);
}

// Called to convert this nodeload instance into a slave
function registerSlave(id, master) {
    SLAVE_CONFIG = new RemoteSlave(id, master);
}

function RemoteSlave(id, master) {
    var master = (master == null) ? ["", 0] : master.split(":");
    this.id = id;
    this.masterhost = master[0];
    this.master = http.createClient(master[1], master[0]);
}
RemoteSlave.prototype = {
    sendReport: function(url, object) {
        var s = JSON.stringify(object);
        var req = this.master.request('POST', url, {'host': this.masterhost, 'content-length': s.length});
        req.write(s);
        req.end();
    },
    reportProgress: function(stats) {
        this.sendReport('/remote/progress', {slaveId: this.id, stats: stats});
    },
}

function RemoteWorkerPool(master, slaves) {
    this.master = master;
    this.slaves = {};
    this.fun = null;
    this.callback = null;
    this.pingId = null;
    this.progressId = null;
    this.stats = {};

    for (var i in slaves) {
        var slave = slaves[i].split(":");
        this.slaves[slaves[i]] = {
            id: slaves[i],
            state: "notstarted",
            host: slave[0], 
            client: http.createClient(slave[1], slave[0])
        };
    }
}
RemoteWorkerPool.prototype = {
    start: function(callback, stayAliveAfterDone) {
        var fun = "(function() {" + this.fun + "})();";
        for (var i in this.slaves) {
            var slave = this.slaves[i];
            var slaveFun = "registerSlave('" + i + "','" + this.master + "');\n" + fun;
            var r = slave.client.request('POST', '/remote', {'host': slave.host, 'content-length': slaveFun.length});
            r.write(slaveFun);
            r.end();
            slave.state = "running";
        }

        var worker = this;
        this.pingId = setInterval(function() { worker.sendPings() }, SLAVE_PING_PERIOD);
        this.callback = testsComplete(callback, stayAliveAfterDone);
        summaryStats = [this.stats];
    },
    checkFinished: function() {
        for (var i in this.slaves) {
            if (this.slaves[i].state != "done" && this.slaves[i].state != "error") {
                return;
            }
        }
        qprint("\nRemote tests complete.");
        
        var callback = this.callback;
        clearInterval(this.pingId);
        this.callback = null;
        this.slaves = {};
        if (callback != null) {
            callback();
        }
    },
    sendPings: function() {
        var worker = this;
        var pong = function(slave) { return function(response) {
            if (slave.state == "ping") {
                if (response.statusCode == 200) {
                    slave.state = "running";
                } else if (response.statusCode == 410) {
                    qprint("\n" + slave.id + " done.");
                    slave.state = "done";
                }
            }
        }}
        var ping = function(slave) {
            slave.state = "ping";
            var r = slave.client.request('GET', '/remote/state', {'host': slave.host, 'content-length': 0});
            r.addListener('response', pong(slave));
            r.end();
        }

        var detectedError = false;
        for (var i in this.slaves) {
            if (this.slaves[i].state == "ping") {
                qprint("\nWARN: slave " + i + " unresponsive.");
                this.slaves[i].state = "error";
                detectedError = true;
            } else if (this.slaves[i].state == "running") {
                ping(this.slaves[i]);
            }
        }
        this.checkFinished();
    },
    scheduleProgressReport: function() {
        if (this.progressId == null) {
            var worker = this;
            this.progressId = setTimeout(function() { 
                defaultProgressReport(worker.stats);
                worker.progressId = null;
            }, 500);
        }
    },
    receiveProgress: function(report) {
        if (this.slaves[report.slaveId] == null)
            return;
        this.slaves[report.slaveId].state = "running";
        for (var i in report.stats) {
            var stat = report.stats[i].name;
            if (this.stats[stat] == null) {
                var backend = statsClassFromString(report.stats[i].interval.type);
                this.stats[stat] = new Reportable([backend, report.stats[i].interval.params], stat, report.stats[i].addToHttpReport);
            }
            this.stats[stat].merge(report.stats[i].interval);
        }
        this.scheduleProgressReport();
    },
}

function serveRemote(url, req, res) {
    var readBody = function(req, callback) {
        var body = '';
        req.addListener('data', function(chunk) { body += chunk });
        req.addListener('end', function() { callback(body) });
    }
    var sendStatus = function(status) {
        res.writeHead(status, {"Content-Length": 0});
        res.end();
    }
    if (req.method == "POST" && url == "/remote") {
        readBody(req, function(remoteFun) {
            qputs("Starting remote test:\n" + remoteFun);
            eval(remoteFun);
            sendStatus(200);
        });
    } else if (req.method == "GET" && req.url == "/remote/state") {
        if (SCHEDULER.running == true) {
            res.writeHead(200, {"Content-Length": 0});
        } else {
            res.writeHead(410, {"Content-Length": 0});
        }
        res.end();
    } else if (req.method == "POST" && url == "/remote/stop") {
        qprint("\nReceived remote stop...");
        SCHEDULER.stopAll();
        sendStatus(200);
    } else if (req.method == "POST" && url == "/remote/progress") {
        readBody(req, function(report) {
            WORKER_POOL.receiveProgress(JSON.parse(report));
            sendStatus(200);
        });
    } else {
        sendStatus(405);
    }
}

