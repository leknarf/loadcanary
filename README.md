NAME
----

    nodeload - Load test tool for HTTP APIs.  Generates result charts and has hooks for generating requests.

SYNOPSIS
--------

    nodeload.js [options] <host>:<port>[<path>]

DESCRIPTION
-----------

    nodeload is for generating lots of requests to send to an HTTP API. By utilizing Node.js's powerful asynchronous abilities it's possible to create an enormous number of requests.

OPTIONS
-------
    
      -n, --number NUMBER              Number of requests to make. Defaults to
                                       value of --concurrency unless a time
                                       limit is specified.
      -c, --concurrency NUMBER         Concurrent number of connections.
                                       Defaults to 1.
      -t, --time-limit NUMBER          Number of seconds to spend running test.
                                       No timelimit by default.
      -m, --method STRING              HTTP method to use.
      -d, --data STRING                Data to send along with PUT or POST
                                       request.
      -f, --flot-chart                 If set, generate an HTML page with a
                                       Flot chart of results.
      -r, --request-generator STRING   Path to module that exports getRequest
                                       function, which should return a request
                                       using the given HTTP client.
      -q, --quiet                      Supress display of progress count info.
      -u, --usage                      Show usage info

ENVIRONMENT
-----------

    nodeload requires node to be installed somewhere on your path. You should
    have a version of node that uses the fs module instead of posix (posix was
    renamed to fs on 2010/02/12).

QUICKSTART
----------
    1. Install node.js.
    2. Clone nodeload.
    3. cd into nodeload working copy.
    4. git submodule update --init
    5. Start testing!

    nodeload contains a toy server that you can use for a quick demo.
    Try the following:

    [~/code/nodeload] node examples/test-server.js &
    [1] 2756
    [~/code/nodeload] Server running at http://127.0.0.1:8000/
    [~/code/nodeload] ./nodeload.js -f -c 10 -n 200 -r ./examples/test-generator.js localhost:8000

    You should now see some test output in your console.  The generated HTML
    report contains a graphical chart of test results.

AUTHORS
-------

    Benjamin Schmaus <benjamin.schmaus@gmail.com>
    Jonathan Lee <jonjlee@gmail.com>

THANKS
------

Thanks to Orlando Vazquez <ovazquez@gmail.com> for the original proof of concept app.

SEE ALSO
--------

    ab(1)
