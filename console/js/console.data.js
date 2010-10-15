var nodes = {};
var selectedNode = null;

function initData() {
    refreshReports = function() {
        if (selectedNode) selectedNode.refreshReportsData();
        setTimeout(function() { refreshReports() }, 2000);
    };
    refreshReports();
}
function getIdFromString(str) {
    return str.replace(/[^a-zA-Z0-9-]/g,'-');
}
function getNodeId(name) {
    var parts = name.split(':');
    if (parts.length == 1)
        return getIdFromString(name) + "-8000";
    return getIdFromString(name);
}
function getNodeObject(name) {
    var nodeId = getNodeId(name);

    if (nodes[nodeId]) return nodes[nodeId];
    var node = nodes[nodeId] = {
        id: nodeId,
        name: name,
        reports: {},
        refreshReportsData: function() { refreshReportsData(node); }
    };

    return node;
}
function deleteNodeObject(node) {
    if (!node) return;
    nodes[node.id] = null;
}

// Stubs
function getTests(nodeId) {
    return ['Read', 'Read+Write']
}
function refreshReportsData(node) {
    node.reports = {
        "Read": {
            "summary": {
                "Read: Latency min": 5,
                "Read: Latency max": 119,
                "Read: Latency avg": 23.8,
                "Read: Latency median": 22,
                "Read: Latency 95%": 38,
                "Read: Latency 99%": 64,
                "Read: Request Bytes total": 0,
                "Read: Response Bytes total": 602208
            },
            "charts": {
                "Read: Latency": {
                    "name": "Read: Latency",
                    "columns": ["time","min","max","avg","median","95%","99%"],
                    "rows": randomize([[0.01,0,0,0,0,0,0],[0.01,5,119,25.3,22,51,107],[0.03,6,54,22.9,22,38,48],[0.05,11,66,23.3,21,37,55]])
                },
                "Read: Request Bytes": {
                    "name": "Read: Request Bytes",
                    "columns": ["time","total"],
                    "rows": randomize([[0.01,0],[0.01,138144],[0.03,153984],[0.05,189024],[0.06,204480]])
                }
            }
        },
        "Write": {
            "summary": {
                "Write: Result codes 404": 6273,
                "Write: Result codes total": 6273,
                "Write: Result codes rps": 2074.4,
            },
            "charts": {
                "Write: Result Codes": {
                    "name": "Write: Result Codes",
                    "columns": ["time","404","total","rps"],
                    "rows": randomize([[0.01,0,0,0],[0.01,1439,1439,1423.3],[0.03,1604,1604,1613.7],[0.05,1969,1969,1969],[0.06,2130,2130,2119.4]])
                }
            }
        }
    }
}

function randomize(list) {
    return list.map(function(x) { 
        var rnd = [x[0]];
        for (var i = 1; i < x.length; i++) {
            rnd[i] = Math.random() * x[i];
        }
        return rnd;
    });
}