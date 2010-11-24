var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var util = require('../util');
var SlaveNode = require('./cluster').SlaveNode;
var HTTP_SERVER = require('../http').HTTP_SERVER;
}

var createSlave_, createMaster_, slaveNodes = [];

/** Global /remote URL handler, which creates a slave endpoint. On receiving a POST request to /remote,
a new route is added to HTTP_SERVER using the handler definition provided in the request body. See 
cluster.js#SlaveNode for a description of the handler defintion. */
HTTP_SERVER.addRoute('^/remote/?$', function(path, req, res) {
    if (req.method === 'POST') {
        util.readStream(req, function(body) {
            var slaveNode;

            // Grab the slave endpoint definition from the HTTP request body; should be valid JSON
            try {
                body = JSON.parse(body);
                slaveNode = new SlaveNode(HTTP_SERVER, body);
            } catch(e) {
                res.writeHead(400);
                res.end(e.toString());
                return;
            }

            slaveNode.on('end', function() {
                slaveNodes = slaveNodes.filter(function(s) { return s !== slaveNode; });
            });
            slaveNodes.push(slaveNode);
            
            res.writeHead(201, {
                'Location': slaveNode.url, 
                'Content-Length': 0,
            });
            res.end();
        });
    } else if (req.method === 'GET') {
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(JSON.stringify(slaveNodes.map(function(s) { return s.url; })));
    } else {
        res.writeHead(405);
        res.end();
    }
});