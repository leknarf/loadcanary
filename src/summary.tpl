REPORT_SUMMARY_TEMPLATE
<html>
    <head>
        <title>Test Results</title>
        <script language="javascript" type="text/javascript"><!--
            <%=DYGRAPH_SOURCE%>
        --></script>
        <style><!--
            body { margin: 0px; font: 13px Arial, Helvetica, sans-serif; }
            h1 { font-size: 2.4em; }
            p, ol, ul { line-height: 30%; }
            a:hover { text-decoration: none; }
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
        --></style>
    </head>

    <body>
        <div id="header"><h1>Test Results</h1><p><%=new Date()%></p></div>
        <div id="page"><div id="content">
           <div class="post"><h2>Summary</h2><div class="entry">
               <p><pre id="reportText"><%=report.text%></pre></p>
           </div></div>
           <% for (var i in report.charts) { %>
                <div class="post"><h2><%=report.charts[i].name%></h2>
                    <div class="entry" style="width:100%;float:left">
                        <div id="chart<%=report.charts[i].uid%>" style="float:left;width:900px;height:200px;"></div>
                        <div id="chart<%=report.charts[i].uid%>legend" style="float:left;width:124px;height:200px;"></div>
                    </div>
                </div>
           <% } %>
        </div></div>
        
        <script id="source" language="javascript" type="text/javascript">
            if(navigator.appName == "Microsoft Internet Explorer") { http = new ActiveXObject("Microsoft.XMLHTTP"); } else { http = new XMLHttpRequest(); }
            setInterval(function() {
               http.open("GET", "/data/<%=querystring.escape(report.name)%>/report-text");
               http.onreadystatechange=function() { if(http.readyState == 4 && http.status == 200) { document.getElementById("reportText").innerText = http.responseText }};
               http.send(null);
            }, <%=SUMMARY_HTML_REFRESH_PERIOD%>);
            <% for (var i in report.charts) { %>
                <% var id = report.charts[i].uid; %>
                graph<%=id%> = new Dygraph(
                    document.getElementById("chart<%=id%>"),
                    <%=JSON.stringify(report.charts[i].rows)%>,
                    {labelsDiv: document.getElementById("chart<%=id%>legend"),
                     labelsSeparateLines: true,
                     labels: <%=JSON.stringify(report.charts[i].columns)%>
                    });
                if(navigator.appName == "Microsoft Internet Explorer") { http<%=id%> = new ActiveXObject("Microsoft.XMLHTTP"); } else { http<%=id%> = new XMLHttpRequest(); }
                setInterval(function() {
                    http<%=id%>.open("GET", "/data/<%=querystring.escape(report.name)%>/<%=querystring.escape(report.charts[i].name)%>");
                    http<%=id%>.onreadystatechange=function() { if(http<%=id%>.readyState == 4) { graph<%=id%>.updateOptions({"file": JSON.parse(http<%=id%>.responseText)});}};
                    http<%=id%>.send(null);
                }, <%=SUMMARY_HTML_REFRESH_PERIOD%>);
            <% } %>
        </script>

        <div id="footer"><p>generated with <a href="http://github.com/benschmaus/nodeload">nodeload</a></p></div>
    </body>
</html>