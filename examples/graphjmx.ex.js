/*jslint forin:true */

var assert = require('assert'),
    child_process = require('child_process'),
    reporting = require('../lib/reporting'),
    REPORT_MANAGER = reporting.REPORT_MANAGER;

REPORT_MANAGER.setLogFile('.reporting.test-output.html');

var hostAndPort = 'localhost:9999',
    refreshInterval = 2;

var report = REPORT_MANAGER.addReport('JMX'),
    memory = report.getChart('Memory'),
    cpu = report.getChart('CPU');

var jmx = reporting.spawnAndMonitor(
            /HeapMemoryUsage.max=(.*) HeapMemoryUsage.committed=(.*) HeapMemoryUsage.used=(.*) SystemLoadAverage=([0-9\.]*)/,
            ['max', 'committed', 'used', 'loadavg'],
            'java', [
              '-jar', 'jmxstat/jmxstat.jar',
              hostAndPort,
              'java.lang:type=Memory[HeapMemoryUsage.max,HeapMemoryUsage.committed,HeapMemoryUsage.used]',
              'java.lang:type=OperatingSystem[SystemLoadAverage]',
              refreshInterval
            ]
          ),
    iostat = reporting.spawnAndMonitor(
            / +[^ ]+ +[^ ]+ +[^ ]+ +([^ ]+) +([^ ]+) +[^ ]+ +[^ ]+ +[^ ]+ +[^ ]+/,
            ['user', 'system'],
            'iostat', [refreshInterval]
          );

jmx.stderr.on('data', function (data) {
  console.log(data.toString());
});

jmx.on('exit', function (code) {
  if (code !== 0) { console.log('JMX monitor died with code ' + code); }
  process.exit(code);
});

jmx.on('data', function(data) {
  memory.put({max: data.max/1024, committed: data.committed/1024, used: data.used/1024});
});

cpu.updateFromEventEmitter(iostat, ['user', 'system']);
