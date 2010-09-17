.PHONY: clean compile

all: compile

clean:
	rm -rf ./dist

SOURCES := src/header.js src/loadapi.js src/evloops.js src/scheduler.js src/remote.js src/http.js src/report.js src/stats.js src/log.js

compile:
	mkdir -p ./dist
	cat ${SOURCES} src/startup.js > ./dist/nodeloadlib.js