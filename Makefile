.PHONY: clean compile

all: compile

clean:
	rm -rf ./dist
	rm results-*-err.log results-*-stats.log results-*-summary.html

SOURCES := src/header.js src/api.js src/evloops.js src/scheduler.js src/remote.js src/report.js src/stats.js src/log.js src/http.js 

compile:
	mkdir -p ./dist
	cat ${SOURCES} > ./dist/nodeloadlib.js
	cp deps/dygraph-combined.js dist/