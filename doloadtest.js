module.exports = {
run: function(params) {
   // This test will hit localhost:8080 with x concurrent connections for y minutes.
    var http = require('http'),
    nl = require('nodeload/nodeload'),
	fs = require('fs');

    var files = fs.readdirSync('.');
    var removeRegex =/results.+(html|log)/;
    for(var i = 0; i < files.length; i++) {
	if(removeRegex.test(files[i])) {
		//console.log(files[i]);
		fs.unlinkSync(files[i]);
	}
    }

    var loadtest = nl.run({
        name: 'Example',
        host: 'localhost',
        port: 8000,
        numClients: 20,
        timeLimit: params.time,
        targetRps: 100,
	loadProfile: [[0,0], [1, params.hitsPeak/10], [5, params.hits/10], [params.time-1, params.hits/10]],
	userProfile: [[0,0], [1, params.usersPeak/10], [5, params.users/10], [params.time-1, params.users/10]],
        stats: ['latency', 'result-codes', { name: 'http-errors', successCodes: [200], log: 'http-errors.log' }],
        requestGenerator: function(client) {
            return client.request('GET', "/" + Math.floor(Math.random()*10000));
        }
    });
    loadtest.keepAlive = true;
    loadtest.on('end', function() { /* process.exit(0); */ });
    return '';

}
};
