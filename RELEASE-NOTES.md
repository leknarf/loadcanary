## v0.2.0 (2010/12/01) ##

This release is a substantial, non-backwards-compatible rewrite of nodeload. The major features are:

* [npm](http://npmjs.org/) compatibility
* Independently usable modules: loop, stats, monitoring, http, reporting, and remote
* Addition of load and user profiles

Specific changes to note are:

* npm should be used to build the source

        [~/nodeload]> curl http://npmjs.org/install.sh | sh     # install npm if not already installed
        [~/nodeload]> npm link

* `nodeload` is renamed to `nl` and `nodeloadlib` to `nodeload`.

* addTest() / addRamp() / runTest() is replaced by run():

        var nl = require('nodeload');
        var loadtest = nl.run({ ... test specications ... }, ...);

* remoteTest() / remoteStart() is replaced by LoadTestCluster.run:

        var nl = require('nodeload');
        var cluster = new nl.LoadTestCluster(master:port, [slaves:port, ...]);
        cluster.run({ ... test specifications ...});

* Callbacks and most of the globals (except `HTTP_SERVER` and `REPORT_MANAGER`) have been removed. Instead EventEmitters are used throughout. For example, run() returns an instance of LoadTest, which emits 'update' and 'end' events, replacing the need for both `TEST_MONITOR` and the startTests() callback parameter.

* Scheduler has been replaced by MultiLoop, which also understands load & concurrency profiles.

* Statistics tracking works through event handlers now rather than by wrapping the loop function. See monitoring/monitor.js.

## v0.100.0 (2010/10/06) ##

This release adds nodeloadlib and moves to Dygraph for charting.

## v0.1.0 to v0.1.2 (2010/02/27) ##

Initial releases of nodeload. Tags correspond to node compatible versions. To find a version of node that's compatible with a tag release do `git show <tagname>`.

    For example: git show v0.1.1