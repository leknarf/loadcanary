.PHONY: clean templates compile
SOURCES = src/header.js src/api.js src/evloops.js src/scheduler.js src/monitor.js src/remote.js src/stats.js src/statsmgr.js src/report.js src/log.js src/http.js src/summary.tpl.js deps/dygraph.js deps/template.js

all: compile

clean:
	rm -rf ./dist
	rm -f results-*-err.log results-*-stats.log results-*-summary.html
	rm -r src/summary.tpl.js

templates:
	echo "`head -n1 src/summary.tpl` = '`awk '{ if (NR > 1) { printf \"%s\\\\\\\\n\", $$0 }}' src/summary.tpl`'" > src/summary.tpl.js

compile: templates
	mkdir -p ./dist
	cat $(SOURCES) | ./deps/jsmin.js > ./dist/nodeloadlib.js
	cp src/options.js src/nodeload.js dist/
