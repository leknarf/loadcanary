// ------------------------------------
// Statistics Manager
// ------------------------------------
//
// This file defines qputs, qprint, and Utils.
//
// Common utility functions.

// A few common global functions so we can access them with as few keystrokes as possible
//
var qputs = exports.qputs = function(s) {
    NODELOAD_CONFIG.QUIET || sys.puts(s); 
};

var qprint = exports.qprint = function(s) {
    NODELOAD_CONFIG.QUIET || sys.print(s); 
};


// Static utility methods
//
var Utils = exports.Utils = {
    uid: function() {
        this.lastUid = this.lastUid || 0;
        return this.lastUid++;
    },
    defaults: function(obj, defaults) {
        for (var i in defaults) {
            if (obj[i] === undefined) {
                obj[i] = defaults[i];
            }
        }
    },
    inherits: function(ctor, superCtor) {
        var proto = ctor.prototype;
        sys.inherits(ctor, superCtor);
        for (var i in proto) { 
            ctor.prototype[i] = proto[i]; 
        }
    }
};