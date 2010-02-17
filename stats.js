var sys = require('sys');

function Histogram(numBuckets) {
    // default histogram size of 5000: when tracking latency at ms resolution, this
    // lets us store latencies up to 5 seconds in the main array
    if (numBuckets == null)
        numBuckets = 5000;
    this.size = numBuckets;
    this.clear();
}
Histogram.prototype =  {
    clear: function() {
        this.start = new Date();
        this.length = 0;
        this.sum = 0;
        this.min = -1;
        this.max = -1;
        this.items = new Array(this.size);      // The main histogram buckets
        this.extra = [];                        // Any items falling outside of the buckets
        this.sorted = true;                     // Is extra[] currently sorted?
    },
    put: function(item) {
        this.length++;
        this.sum += item;
        if (item < this.min || this.min == -1) this.min = item;
        if (item > this.max || this.max == -1) this.max = item;
        
        if (item < this.items.length) {
            if (this.items[item] != null) {
                this.items[item]++;
            } else {
                this.items[item] = 1;
            }
        } else {
            this.sorted = false;
            this.extra.push(item);
        }
    },
    get: function(item) {
        if (item < this.items.length) {
            return this.items[item];
        } else {
            var count = 0;
            for (i in this.extra) {
                if (this.extra[i] == item) {
                    count++;
                }
            }
            return count;
        }
    },
    mean: function() {
        return this.sum / this.length;
    },
    percentile: function(percentile) {
        var target = Math.floor(this.length * (1 - percentile));
        
        if (this.extra.length > target) {
            var idx = this.extra.length - target;
            if (!this.sorted) {
                this.extra = this.extra.sort(function(a, b) { return a - b });
                this.sorted = true;
            }
            return this.extra[idx];
        } else {
            var sum = this.extra.length;
            for (var i = this.items.length - 1; i >= 0; i--) {
                if (this.items[i] != null) {
                    sum += this.items[i];
                    if (sum >= target) {
                        return i;
                    }
                }
            }
            sys.puts("WARNING: no " + percentile + " percentile found; returning 0");
            return 0;
        }
    },
    stddev: function() {
        var mean = this.mean();
        var s = 0;
        
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i] != null) {
                s += this.items[i] * Math.pow(i - mean, 2);
            }
        }
        this.extra.forEach(function (val) {
            s += Math.pow(val - mean, 2);
        });
        return Math.sqrt(s / this.length);
    },
    summary: function() {
        return '"count": ' + this.length +
            ', "min": ' + this.min +
            ', "mean": ' + this.mean().toFixed(1) +
            ', "median": ' + this.percentile(.5) +
            ', "95%": ' + this.percentile(.95) +
            ', "99%": ' + this.percentile(.99);
    }
}

function Accumulator() {
    this.total = 0;
    this.length = 0;
}
Accumulator.prototype = {
    put: function(stat) {
        this.total += stat;
        this.length++;
    },
    get: function() {
        return this.total;
    },
    clear: function() {
        this.total = 0;
        this.length = 0;
    },
    summary: function() {
        return '"total": ' + this.total;
    }
}

function ResultCounter() {
    this.items = [];
    this.length = 0;
}
ResultCounter.prototype = {
    put: function(item) {
        if (this.items[item] != null) {
            this.items[item]++;
        } else {
            this.items[item] = 1;
        }
        this.length++;
    },
    get: function(item) {
        return this.items[item];
    },
    clear: function() {
        this.items = [];
        this.length = 0;
    },
    summary: function() {
        var s = '';
        for (item in this.items) {
            if (s.length > 0)
                s += ", ";
            s += '"' + item + '": "' + this.items[item] + '"';
        }
        return s;
    }
}

function Peak() {
    this.peak = 0;
    this.length = 0;
}
Peak.prototype = {
    put: function(item) {
        if (this.peak < item) {
            this.peak = item;
        }
        this.length++;
    },
    get: function(item) {
        return this.peak;
    },
    clear: function() {
        this.peak = 0;
    },
    summary: function() {
        return '"max": ' + '"' + this.peak + '"';
    }
}

function Monitorable(backend, id) {
    this.id = id;
    this.interval = new backend();
    this.cumulative = new backend();
}
Monitorable.prototype = {
    put: function(stat) {
        this.interval.put(stat);
        this.cumulative.put(stat);
    },
    next: function() {
        if (this.interval.length > 0)
            this.interval.clear();
    }
}

exports.Histogram = Histogram;
exports.Accumulator = Accumulator;
exports.ResultCounter = ResultCounter;
exports.Peak = Peak;
exports.Monitorable = Monitorable;
