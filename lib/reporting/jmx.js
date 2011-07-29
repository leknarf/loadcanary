/*jslint forin:true */

var BUILD_AS_SINGLE_FILE;
if (!BUILD_AS_SINGLE_FILE) {
var child_process = require('child_process');
var REPORT_MANAGER = require('./reportmanager').REPORT_MANAGER;
}

var spawnAndMonitor;

var graphJmx = exports.graphJmx = function(options) {
  // Verify that java & jmxstat jar can be found
  
  // Build command line args, output regex, and field labels
  var regex = '\\d{2}:\\d{2}:\\d{2}',
    labels = [],
    mbeans = [];
  for (var m in options.mbeans) {
    regex += '\\t([^\\t]*)';
    labels.push(m);
    mbeans.push(options.mbeans[m]);
  }
  regex = new RegExp(regex);
    
  // Add graph
  var report = REPORT_MANAGER.addReport(options.host),
      graph = report.getChart(options.title);

  // Spawn jmxstat
  var jmx = spawnAndMonitor(
    regex, labels,
    'java', ['-jar', 'jmxstat/jmxstat.jar', options.host].concat(mbeans).concat(options.interval)
  );
  
  if (options.dataFormatter) {
    jmx.on('data', function(data) {
      graph.put(options.dataFormatter(data));
    });
  } else {
    graph.updateFromEventEmitter(jmx, labels);
  }
};

/** Spawn a child process and extract data using a regex. Each line is compared to the regex. If a match
is found, the groups are written to an object using the given field names, and the 'data' event is
emitted.

Returns a standard ChildProcess object, extended to emit('data', object).

For example, if 'ls -al' prints:

  drwxr-xr-x  22 user  staff     748 Feb  7 10:54 ./
  drwxr-xr-x  23 user  staff     782 Feb  7 09:10 ../
  -rw-r-----   1 user  staff      68 Jan 12 17:03 .gitignore

then:

  spawnAndMonitor(
    /-(.)..(.)..(.)../, ['userReadable', 'groupReadable', 'worldReadable'],
    'ls', ['-al']);

will emit('data', {userReadable: 'r', groupReadable: 'r', worldReadable: '-'});
*/
function spawnAndMonitor(regex, fields, spawnArguments) {
  var buf = '', proc = child_process.spawn.apply(child_process, Array.prototype.slice.call(arguments, 2));
  proc.stdout.on('data', function (data) {
    buf += data.toString();

    var lines = buf.split('\n');
    buf = lines.pop();

    lines.forEach(function(line) {
      var vals = line.match(regex);
      if (vals) {
        if (fields) {
          var obj = {};
          for (var i = 1; i < vals.length; i++) {
            obj[fields[i-1]] = vals[i];
          }
          proc.emit('data', obj);
        } else {
          proc.emit('data', vals);
        }
      }
    });
  });
  return proc;
}