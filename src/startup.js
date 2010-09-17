// ------------------------------------
// Initialization
// ------------------------------------
if (typeof QUIET == "undefined")
    QUIET = false;

if (typeof TEST_CONFIG == "undefined") {
    setTestConfig('short');
} else {
    setTestConfig(TEST_CONFIG);
}

if (typeof SCHEDULER == "undefined")
    SCHEDULER = new Scheduler();

if (typeof HTTP_REPORT == "undefined")
    HTTP_REPORT = new Report("main");

if (typeof HTTP_SERVER_PORT == "undefined") {
    HTTP_SERVER_PORT = 8000;
    if (process.env['HTTP_SERVER_PORT'] != null) {
        HTTP_SERVER_PORT = Number(process.env['HTTP_SERVER_PORT']);
    }
}
    
if (typeof DISABLE_HTTP_SERVER == "undefined" || DISABLE_HTTP_SERVER == false)
    startHttpServer(HTTP_SERVER_PORT);

if (typeof DISABLE_LOGS == "undefined")
    DISABLE_LOGS = false;

openAllLogs();