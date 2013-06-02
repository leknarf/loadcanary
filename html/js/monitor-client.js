
var lastHash = '';
$(document).ready(function() {
        setInterval(function() {
               $.get('http://localhost:1337/getdata', function(data) {
                        var currentHtml = $('#response').html();
                        if(lastHash == data.md5) {
                                return;
                        }
                        lastHash = data.md5;
                        var dataArray = data.data;
                        var lastData = dataArray[dataArray.length - 1];
                        var lat = lastData && lastData.latency && lastData.latency.avg ? lastData.latency.avg : 0;
                        $('#response').html(currentHtml + "<br/>" + lat);
                });
        },500);
});

