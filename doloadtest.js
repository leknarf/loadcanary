module.exports = {
run: function() {
   // This test will hit localhost:8080 with 20 concurrent connections for 10 minutes.
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
        timeLimit: 30,
        targetRps: 200,
	loadProfile: [[0,0], [3, 20], [6, 200], [9, 300]],
	userProfile: [[0,0], [3, 2], [6, 20], [9, 50]],
        stats: ['latency', 'result-codes', { name: 'http-errors', successCodes: [200], log: 'http-errors.log' }],
        requestGenerator: function(client) {
            return client.request('GET', "/" + Math.floor(Math.random()*10000));
        }
    });
    loadtest.on('end', function() { /* process.exit(0); */ });
    return '';

}
};
