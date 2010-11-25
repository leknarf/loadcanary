.PHONY: clean templates compile
PROCESS_TPL = scripts/process_tpl.js
SOURCES = lib/header.js lib/*.tpl.js lib/template.js lib/config.js lib/util.js lib/stats.js lib/loop/loop.js lib/loop/multiloop.js lib/monitoring/collectors.js lib/monitoring/statslogger.js lib/monitoring/monitor.js lib/monitoring/monitorgroup.js lib/http.js lib/reporting.js lib/loadtesting.js lib/remote/endpoint.js lib/remote/endpointclient.js lib/remote/slave.js lib/remote/slavenode.js lib/remote/cluster.js lib/remote/http.js

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