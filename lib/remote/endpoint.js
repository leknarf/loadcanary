/*jslint sub: true */
var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var http = require('http');
var url = require('url');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var qputs = util.qputs;
}

var DEFAULT_RETRY_INTERVAL_MS = 2000;

/** Endpoint represents an a collection of functions that can be executed by POSTing parameters to an
HTTP server.

When Endpoint is started it adds the a unique route, /remote/{uid}/{method}, to server.
When a POST request is received, it calls method() with the request body as it's parameters.

The available methods for this endpoint are defined by calling defineMethod(...). */
var Endpoint = exports.Endpoint = function Endpoint(server) {
    EventEmitter.call(this);

    var self = this, 
        basepath = '',
        updateUrl = function() {
            self.url = url.format({
                protocol: 'http', 
                hostname: server.hostname,
                port: server.port,
                pathname: basepath
            });
        };
    self.__defineGetter__('basepath', function() { return basepath; });
    self.__defineSetter__('basepath', function(val) {
        basepath = val;
        updateUrl();
    });
    
    self.id = util.uid();
    self.basepath = '/remote/' + self.id;
    self.route = '^' + self.basepath + '/?';
    self.server = server;
    self.methodNames = [];
    self.methods = {};
    self.context = {};
    self.setStaticParams([]);
    self.state = 'initialized';
    self.handler_ = self.handle.bind(self);
    
    self.server.on('start', function(hostname, port) { updateUrl(); });
};

util.inherits(Endpoint, EventEmitter);

/** Set values that are passed as the initial arguments to every handler method. For example, if you:

    var id = 123, name = 'myobject';
    endpoint.setStaticParams([id, name]);

You should define methods:

    endpoint.defineMethod('method_1', function(id, name, arg1, arg2...) {...});

which are called by:

    endpoint.method_1(arg1, arg2...)

*/
Endpoint.prototype.setStaticParams = function(params) {
    this.staticParams_ = params instanceof Array ? params : [params];
};

/** Define a method that can be executed by POSTing to /basepath/method-name. For example:

    endpoint.defineMethod('method_1', function(data) { return data; });

then POSTing '[123]' to /{basepath}/method_1 will respond with a message with body 123.

*/
Endpoint.prototype.defineMethod = function(name, fun) {
    this.methodNames.push(name);
    this.methods[name] = fun;
};

/** Start responding to requests to this endpoint by adding the proper route to the HTTP server*/
Endpoint.prototype.start = function() {
    if (this.state !== 'initialized') { return; }
    this.server.addRoute(this.route, this.handler_);
    if (this.methods['setup']) {
        this.methods['setup'].apply(this.context, this.staticParams_);
    }
    this.state = 'started';
    this.emit('start');
};

/** Remove the HTTP server route and stop responding to requests */
Endpoint.prototype.destroy = function() {
    if (this.state !== 'started') { return; }
    this.server.removeRoute(this.route, this.handler_);
    this.state = 'destroyed';
    this.emit('end');
};

/** The main HTTP request handler. On DELETE /{basepath}, it will self-destruct this endpoint. POST 
requests are routed to the function set by defineMethod(), applying the HTTP request body as parameters,
and sending return value back in the HTTP response. */
Endpoint.prototype.handle = function(path, req, res) {
    var self = this;
    if (path === self.basepath) {
        if (req.method === 'DELETE') {
            self.destroy();
            res.writeHead(204, {'Content-Length': 0});
            res.end();
        } else {
            res.writeHead(405);
            res.end();
        }
    } else if (req.method === 'POST') {
        var method = path.slice(this.basepath.length+1);
        if (self.methods[method]) {
            util.readStream(req, function(params) {
                var status = 200, ret = 'undefined';
                
                try {
                    params = JSON.parse(params);
                } catch(e1) {
                    res.writeHead(400);
                    res.end();
                    return;
                }
                
                params = (params instanceof Array) ? params : [params];
                ret = self.methods[method].apply(self.context, self.staticParams_.concat(params));

                try {
                    ret = ret ? JSON.stringify(ret) : '';
                } catch(e2) {
                    ret = e2.toString();
                    status = 500;
                }

                res.writeHead(status, {'Content-Length': ret.length, 'Content-Type': 'application/json'});
                res.end(ret);
            });
        } else {
            res.writeHead(404);
            res.end();
        }
    } else {
        res.writeHead(405);
        res.end();
    }
};


/** EndpointClient represents an HTTP connection to an Endpoint. The supported methods should be added
by calling defineMethod(...). For example,

    client = new EndpointClient('myserver', 8000, '/remote/0');
    client.defineMethod('method_1');
    client.start();
    client.on('connect', function() {
        client.method_1(args);
    });

will send a POST request to http://myserver:8000/remote/0/method_1 with the body [args], which causes
the Endpoint listening on myserver to execute method_1(args). */
var EndpointClient = exports.EndpointClient = function EndpointClient(host, port, basepath) {
    EventEmitter.call(this);
    this.host = host;
    this.port = port;
    this.basepath = basepath || '';
    this.methodNames = [];
    this.state = 'disconnected';
    this.retryInterval = DEFAULT_RETRY_INTERVAL_MS;
    this.setStaticParams([]);
};
util.inherits(EndpointClient, EventEmitter);
/** Establish an HTTP connection to the target server. Emit 'connect' when connected. */
EndpointClient.prototype.start = function() {
    if (this.state !== 'disconnected' && this.state !== 'reconnect') { return; }

    var self = this;

    clearTimeout(self.retryTimeoutId);
    self.retryTimeoutId = null;

    if (self.client) { self.client.destroy(); }
    self.client = http.createClient(self.port, self.host);
    self.client.on('error', function(err) {
        qputs('Communication error with "'+ self.host +':'+ self.port +'". Reconnecting: '+ err.toString());
        self.state = 'reconnect';
        self.client.destroy();
        self.client = null;
        self.retryTimeoutId = setTimeout(self.start.bind(self), self.retryInterval);
        self.emit('clientError', err);
    });
    self.state = 'connected';
    self.emit('connect');
};
/** Terminate the HTTP connection. */
EndpointClient.prototype.end = function() {
    if (this.state !== 'connected' && this.state !== 'reconnect') { return; }
    clearTimeout(this.retryTimeoutId);
    this.client.destroy();
    this.state = 'disconnected';
    this.emit('end');
};
/** Send an arbitrary HTTP request using the underlying http.Client. */
EndpointClient.prototype.rawRequest = function() {
    return this.client.request.apply(this.client, arguments);
};
EndpointClient.prototype.setStaticParams = function(params) {
    this.staticParams_ = params instanceof Array ? params : [params];
};
/** Add a method that the target server understands. The method can be executed by calling 
endpointClient.method(args...). */
EndpointClient.prototype.defineMethod = function(name) {
    var self = this;
    self[name] = function() {
        if (self.state !== 'connected') { throw new Error('Cannot call method before connect'); }
        var req = self.client.request('POST', self.basepath + '/' + name),
            params = self.staticParams_.concat(util.argarray(arguments));

        req.end(JSON.stringify(params));
        return req;
    };
    self.methodNames.push(name);
};