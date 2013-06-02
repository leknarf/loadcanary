module.exports = {
run: function() {
    var fs = require('fs');
    var crypto = require('crypto');
    
    var files = fs.readdirSync('.');
    var resultRegex =/results.+(log)/;
    var resultFile = '';
    for(var i = 0; i < files.length; i++) {
	if(resultRegex.test(files[i])) {
		resultFile = files[i];
	}
    }

	var result = fs.readFileSync(resultFile);
	var md5sum = crypto.createHash('md5');
    	md5sum.update(result);
	result = result.toString();
	result = result.substring(0, result.length - 2);
	var resultJson = JSON.parse("{\"data\": ["+result+"]}");
	resultJson.md5 = md5sum.digest('hex');
	return resultJson;
}
};
