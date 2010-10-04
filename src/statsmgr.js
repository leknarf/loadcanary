// The global statistics manager that updates test stats and writes to the stats log throughout a load test.
//
var STATS_MANAGER = {
    statsSets: [],
    addStatsSet: function(stats) {
        this.statsSets.push(stats);
    },
    updateStats: function() {
        var out = '{"ts": ' + JSON.stringify(new Date());
        for (var i in this.statsSets) {
            for (var j in this.statsSets[i]) {
                var stat = this.statsSets[i][j];
                stat.next();
                var summary = stat.lastSummary.interval;
                out += ', "' + stat.name + '": ' + JSON.stringify(summary);
            }
        }
        out += "}";
        STATS_LOG.put(out + ",");
    },
    reset: function() {
        this.stats = [];
    }
}
TEST_MONITOR.on('test', function(test) { if (test.stats) STATS_MANAGER.addStatsSet(test.stats) });
TEST_MONITOR.on('update', function() { STATS_MANAGER.updateStats() });
TEST_MONITOR.on('end', function() { STATS_MANAGER.reset() });