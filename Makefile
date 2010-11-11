.PHONY: clean templates compile
PROCESS_TPL = scripts/process_tpl.js
SOURCES = lib/header.js lib/*.tpl.js lib/utils.js lib/config.js lib/testapi.js lib/job.js lib/monitoring.js lib/remote.js lib/stats.js lib/log.js lib/reporting.js lib/http.js lib/template.js

all: compile

clean:
	rm -rf ./lib-cov
	rm -f ./lib/nodeload.js ./lib/*.tpl.js
	rm -f results-*-err.log results-*-stats.log results-*-summary.html

templates:
	$(PROCESS_TPL) REPORT_SUMMARY_TEMPLATE lib/summary.tpl > lib/summary.tpl.js
	$(PROCESS_TPL) DYGRAPH_SOURCE lib/dygraph.tpl > lib/dygraph.tpl.js

compile: templates
	echo "#!/usr/bin/env node" > ./lib/nodeload.js
	cat $(SOURCES) | ./scripts/jsmin.js >> ./lib/nodeload.js
	chmod +x ./lib/nodeload.js