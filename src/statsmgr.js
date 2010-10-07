// ------------------------------------
// Statistics Manager
// ------------------------------------
//
// This file defines STATS_MANAGER.
//

/** The global statistics manager. Periodically process test statistics and logs them to disk during a
load test run. */
var STATS_MANAGER = {
    statsSets: [],
    addStatsSet: function(stats) {
        this.statsSets.push(stats);
    },
    logStats: function() {
        var out = '{"ts": ' + JSON.stringify(new Date());
        this.statsSets.forEach(function(statsSet) {
            for (var i in statsSet) {
                var stat = statsSet[i];
                out += ', "' + stat.name + '": ' + JSON.stringify(stat.summary().interval);
            }
        });
        out += "}";
        LOGS.STATS_LOG.put(out + ",\n");
    },
    prepareNextInterval: function() {
        this.statsSets.forEach(function(statsSet) {
            for (var i in statsSet) {
                statsSet[i].next();
            }
        });
    },
    reset: function() {
        this.statsSets = [];
    }
}
TEST_MONITOR.on('test', function(test) { if (test.stats) STATS_MANAGER.addStatsSet(test.stats) });
TEST_MONITOR.on('update', function() { STATS_MANAGER.logStats() });
TEST_MONITOR.on('afterUpdate', function() { STATS_MANAGER.prepareNextInterval() })
TEST_MONITOR.on('end', function() { STATS_MANAGER.reset() });