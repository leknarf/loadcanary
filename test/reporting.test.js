/*jslint sub:true */

var reporting = require('../lib/reporting').disableServer(),
    monitoring = require('../lib/monitoring'),
    REPORT_MANAGER = reporting.REPORT_MANAGER;

REPORT_MANAGER.refreshIntervalMs = 500;
REPORT_MANAGER.startLogger('.reporting.test-output.html');
setTimeout(function() { REPORT_MANAGER.stopLogger(); }, 1000);

function mockConnection(callback) {
    var conn = { 
        operation: function(opcallback) { 
            setTimeout(function() { opcallback(); }, 25);
        }
    };
    setTimeout(function() { callback(conn); }, 75);
}

module.exports = {
    'example: add a chart to test summary webpage': function(assert, beforeExit) {
        var report = REPORT_MANAGER.addReport('My Report'),
            chart1 = report.getChart('Chart 1'),
            chart2 = report.getChart('Chart 2');
        
        chart1.put({'line 1': 1, 'line 2': -1});
        chart1.put({'line 1': 2, 'line 2': -2});
        chart1.put({'line 1': 3, 'line 2': -3});
        
        chart2.put({'line 1': 10, 'line 2': -10});
        chart2.put({'line 1': 11, 'line 2': -11});
        chart2.put({'line 1': 12, 'line 2': -12});
        
        report.summary = {
            "statistic 1" : 500,
            "statistic 2" : 'text',
        };
        
        var html = REPORT_MANAGER.getHtml();
        assert.isNotNull(html.match('id="chart'+chart1.uid));
        assert.isNotNull(html.match('id="chart'+chart2.uid));
        assert.isNotNull(html.match('graph'+chart1.uid+' = new Dygraph'));
        assert.isNotNull(html.match('graph'+chart2.uid+' = new Dygraph'));
        assert.isNotNull(html.match('id="reportSummary'+report.uid));
    },
    'example: update reports from Monitor and MonitorSet stats': function(assert, beforeExit) {
        var m = new monitoring.MonitorSet('runtime')
                        .init('transaction', 'operation')
                        .updateEvery(200),
            f = function() {
                var trmon = m.start('transaction');
                mockConnection(function(conn) {
                    var opmon = m.start('operation');
                    conn.operation(function() {
                        opmon.end();
                        trmon.end();
                    });
                });
            };
        
        REPORT_MANAGER.addReport('All Monitors').updateFromMonitorSet(m);
        REPORT_MANAGER.addReport('Transaction').updateFromMonitor(m.monitors['transaction']);
        REPORT_MANAGER.addReport('Operation').updateFromMonitor(m.monitors['operation']);
    
        for (var i = 1; i <= 10; i++) {
            setTimeout(f, i*50);
        }
    
        // Disable 'update' events after 500ms so that this test can complete
        setTimeout(function() { m.disableUpdates(); }, 510);
        
        beforeExit(function() {
            var trReport = REPORT_MANAGER.reports.filter(function(r) { return r.name === 'Transaction'; })[0];
            var opReport = REPORT_MANAGER.reports.filter(function(r) { return r.name === 'Operation'; })[0];
            assert.ok(trReport && (trReport.name === 'Transaction') && trReport.charts['runtime']);
            assert.ok(opReport && (opReport.name === 'Operation') && opReport.charts['runtime']);
            assert.equal(trReport.charts['runtime'].rows.length, 3);    // 1+2, since first row is [[0,...]]
            assert.equal(opReport.charts['runtime'].rows.length, 3);
            assert.ok(Math.abs(trReport.charts['runtime'].rows[2][3] - 100) < 10); // third column is 'median'
        });
    },
};