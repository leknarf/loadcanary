<html>
    <head>
        <title>Test Results</title>
        <script language="javascript" type="text/javascript"><!--
            <%=DYGRAPH_SOURCE%>
            function jsonToTable(json) {
                var txt = "";
                for (var i in json)
                    txt += "<tr><td class=label>" + i + "</td><td>" + json[i] + "</td></tr>";
                return "<table>" + txt + "</table>";
            };
        --></script>
        <style><!--
            body { margin: 0px; font: 13px Arial, Helvetica, sans-serif; }
            h1 { font-size: 2.4em; }
            p, ol, ul { line-height: 30%; }
            a:hover { text-decoration: none; }
            #main { float:left; width: 740px; }
            #sidebar { float:right; width: 260px; height: 100%; border-left: #BFC9AE solid 1px; margin-left: 10px; padding-left: 10px;}
            #header { width: 100%; height: 100px; margin: 0px auto; color: #FFFFFF; background: #699C4D; border: 3px solid darkgreen; border-style: none none solid none;}
            #header h1 { width: 1024; padding: 25px 0px 0px 0px; margin: 0px auto; font-weight: normal; }
            #header p { width: 1024; padding: 15px 0px 0px 0px; margin: 0px auto; }
            #page { width: 1024px; margin: 0px auto; padding: 30px 0px; }
            .post { margin: 0px 0px 30px 0px; }
            .post h1, .post h2 { margin: 0px; padding: 0px 0px 5px 0px; border-bottom: #BFC9AE solid 1px; color: #232F01; }
            .entry { margin: 10px 0px 20px 0px; }
            #footer { clear: both; width: 1024px; height: 50px; margin: 0px auto 30px auto; color: #FFFFFF; background: #699C4D; }
            #footer p { padding: 19px 0px 0px 0px; text-align: center; line-height: normal; font-size: smaller; }
            #footer a { color: #FFFFFF; }
            .statsTable table { font-size: small; font-variant: small-caps; border-spacing: 10px 1px; }
            .statsTable .label { text-align:right; }
        --></style>
    </head>

    <body>
        <div id="header"><h1>Test Results</h1><p id="timestamp"><%=new Date()%></p></div>
        <div id="page">
            <div id="main">
                <% reports.forEach(function(report) { %>
                <% for (var j in report.charts) { %>
                <% var chart = report.charts[j]; %>
                    <div class="post"><h2><%=report.name%>: <%=chart.name%></h2>
                        <div class="entry" style="width:100%;float:left">
                            <div id="chart<%=chart.uid%>" style="float:left;width:660px;height:200px;"></div>
                            <div id="chart<%=chart.uid%>legend" style="float:left;width:80px;height:200px;"></div>
                        </div>
                    </div>
                <% } %>
                <% }); %>
            </div>
            <div id="sidebar">
                <div class="post"><h2>Cumulative</h2><div class="entry">
                    <% reports.forEach(function(report) { %>
                        <p class="statsTable" id="reportSummary<%=report.uid%>"/></p>
                        <script language="javascript" type="text/javascript">
                            document.getElementById("reportSummary<%=report.uid%>").innerHTML = jsonToTable(<%=JSON.stringify(report.summary)%>);
                        </script>
                    <% }); %>
                </div></div>
            </div>
        </div></div>
        
        
        <script id="source" language="javascript" type="text/javascript">
            if(navigator.appName == "Microsoft Internet Explorer") { http = new ActiveXObject("Microsoft.XMLHTTP"); } else { http = new XMLHttpRequest(); }
            <% reports.forEach(function(report) { %>
                <% for (var j in report.charts) { %>
                <% var chart = report.charts[j]; %>
                <% var id = chart.uid; %>
                        graph<%=id%> = new Dygraph(
                            document.getElementById("chart<%=id%>"),
                            <%=JSON.stringify(chart.rows)%>,
                            {labelsDiv: document.getElementById("chart<%=id%>legend"),
                             labelsSeparateLines: true,
                             labels: <%=JSON.stringify(chart.columns)%>
                            });
                <% } %>
            <% }); %>
            setInterval(function() {
                http.open("GET", "/reports");
                http.onreadystatechange=function() { 
                    if (http.readyState == 4 && http.status == 200) {
                        document.getElementById("timestamp").innerHTML = new Date();
                        reports = JSON.parse(http.responseText);
                        reports.forEach(function(report) {
                            document.getElementById("reportSummary" + report.uid).innerHTML = jsonToTable(report.summary);
                            for (var j in report.charts) {
                                var chart = report.charts[j];
                                this["graph" + chart.uid].updateOptions({"file": report.charts[j].rows});
                            }
                        });
                    }
                }
                http.send(null);
            }, <%=refreshPeriodMs%>);
        </script>

        <div id="footer"><p>generated with <a href="http://github.com/benschmaus/nodeload">nodeload</a></p></div>
    </body>
</html>