var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var http = require('http');
var util = require('../util');
var EventEmitter = require('events').EventEmitter;
var qputs = util.qputs;
}

var DEFAULT_RETRY_INTERVAL_MS = 2000;

/** EndpointClient represents an HTTP connection to an Endpoint. The supported methods should be added
by calling defineMethod(...). For example,

    client = new EndpointClient('myserver', 8000, '/remote/0');
    client.defineMethod('method_1');
    client.on('connect', function() {
        client.method_1(args);
    });

will send a POST request to http://myserver:8000/remote/0/method_1 with the body [args], which causes
the Endpoint listening on myserver to execute method_1(args).

EndpointClient emits the following events:
- 'connect': An HTTP connection to the remote endpoint has been established. Methods may now be called.
- 'clientError', error: The underlying HTTP connection returned an error. The connection will be retried.
- 'end': The underlying HTTP connect has been terminated. No more events will be emitted.

EndpointClient.state can be:
- 'initialized': A connection to the remote endpoint has not yet been established
- 'connected': Connection to the remote endpoint is established
- 'reconnect': An error occured in the HTTP connection. It will be re-established if possible.
*/
var EndpointClient = exports.EndpointClient = function EndpointClient(host, port, basepath) {
    EventEmitter.call(this);
    this.host = host;
    this.port = port;
    this.basepath = basepath || '';
    this.methodNames = [];
    this.retryInterval = DEFAULT_RETRY_INTERVAL_MS;
    this.setStaticParams([]);
    this.state = 'initialized';
    this.connect_();
};
util.inherits(EndpointClient, EventEmitter);
/** Establish an HTTP connection to the target server. Emit 'connect' when connected. */
EndpointClient.prototype.connect_ = function() {
    var self = this;
    if (self.state !== 'initialized' && self.state !== 'reconnect') { return; }

    self.retryTimeoutId = clearTimeout(self.retryTimeoutId);

    if (self.client) { self.client.destroy(); }
    self.client = http.createClient(self.port, self.host);
    self.client.on('error', function(err) {
        qputs('Communication error with "'+ self.host +':'+ self.port +'". Reconnecting: '+ err.toString());
        self.state = 'reconnect';
        self.emit('clientError', err);
    });
    self.state = 'connected';
    self.emit('connect');
};
/** Terminate the HTTP connection. */
EndpointClient.prototype.destroy = function() {
    if (this.state !== 'connected' && this.state !== 'reconnect') { return; }
    clearTimeout(this.retryTimeoutId);
    this.client.destroy();
    this.state = 'initialized';
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
        if (self.state !== 'connected' && this.state !== 'reconnect') {
            throw new Error('Cannot call method before connect'); 
        }
        var req = self.client.request('POST', self.basepath + '/' + name),
            params = self.staticParams_.concat(util.argarray(arguments));

        req.end(JSON.stringify(params));
        return req;
    };
    self.methodNames.push(name);
    return self;
};