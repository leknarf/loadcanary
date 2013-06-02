var current_real_users = 100;
var normal_virtual_users = 500;
var current_virtual_users = normal_virtual_users;
var normal_latency = .7;
var current_latency = normal_latency;
var drop_virtual_users_at_latency = 1;
var max_user_capacity = 1000;
var data_latency = [], data_real_users = [], data_virtual_users = [], time = (new Date()).getTime();


function get_real_users() {
    current_real_users = current_real_users + Math.round(Math.random()*6);
    return current_real_users;
}
function get_virtual_users() {
    if((current_virtual_users) < 700 && current_latency < drop_virtual_users_at_latency) {
        current_virtual_users = current_virtual_users + Math.round(Math.random()*10);
    }
    else if(current_latency > drop_virtual_users_at_latency) {
        current_virtual_users = Math.round(current_virtual_users*.5);
    }
    else {
        current_virtual_users = current_virtual_users;
    }

    if(current_virtual_users < 0)
        current_virtual_users = 0;

    return current_virtual_users;
}
function get_latency() {
    if((current_virtual_users + current_real_users) > max_user_capacity) {
        current_latency = ( normal_latency + (((current_virtual_users + current_real_users)-max_user_capacity)/100) );
    } else {
        current_latency = normal_latency - .1 + Math.random()*.2
    }

    return current_latency;
}

for (i = -900; i <= 0; i=i+5) {
    data_latency.push({
        x: time + i * 1000,
        y: get_latency()
    });
    data_real_users.push({
        x: time + i * 1000,
        y: get_real_users()
    });
    data_virtual_users.push({
        x: time + i * 1000,
        y: (get_virtual_users() + current_real_users)
    });
}

$(function () {
    $(document).ready(function() {
        Highcharts.setOptions({
            global: {
                useUTC: false
            }
        });

        $('#container2').highcharts({
            chart: {
                type: 'areaspline',
                animation: Highcharts.svg, // don't animate in old IE
                marginRight: 10,
                events: {
                    load: function() {

                        // set up the updating of the chart each second
                        var series = this.series;
                        setInterval(function() {
                            var x = (new Date()).getTime();
                            series[0].addPoint([x, get_virtual_users()], false, true);
                            series[1].addPoint([x, get_real_users()], true, true);
                        }, 5000);
                    }
                }
            },
            title: {
                text: 'Newsweek.com User Load'
            },
            xAxis: {
                type: 'datetime',
                title: {text:'Time'}
            },
            yAxis: {
                title: {
                    text: 'Total Users'
                },
                plotLines: [{
                    value: 0,
                    width: 1,
                    color: '#808080'
                }]
            },
            tooltip: {
                formatter: function() {
                    return Highcharts.dateFormat('%Y-%m-%d %H:%M:%S', this.points[0].x) +'<br/>'+
                        '<b>Virtual Users:</b> '+Math.round(Highcharts.numberFormat(this.points[0].y, 2)-Highcharts.numberFormat(this.points[1].y, 2)) + '<br/>'+
                        '<b>Real Users:</b> '+Highcharts.numberFormat(this.points[1].y, 2);
                },
                shared: true
            },
            legend: {
                enabled: true
            },
            exporting: {
                enabled: false
            },
            series: [{
                name: 'Virtual Users',
                data: data_virtual_users
            },{
                name: 'Real Users',
                data: data_real_users
            }],
            plotOptions: {
                areaspline: {marker: {enabled: false}}
            }
        });

        $('#container').highcharts({
            chart: {
                type: 'spline',
                animation: Highcharts.svg, // don't animate in old IE
                marginRight: 10,
                events: {
                    load: function() {

                        // set up the updating of the chart each second
                        var series = this.series;
                        setInterval(function() {
                            var x = (new Date()).getTime();
                            series[0].addPoint([x, get_latency()], true, true);
                        }, 5000);
                    }
                }
            },
            title: {
                text: 'Newsweek.com Latency'
            },
            xAxis: {
                type: 'datetime',
                title: {text:'Time'}
            },
            yAxis: {
                title: {
                    text: 'Latency'
                },
                plotLines: [{
                    value: 0,
                    width: 1,
                    color: '#808080'
                }]
            },
            tooltip: {
                formatter: function() {
                    return Highcharts.dateFormat('%Y-%m-%d %H:%M:%S', this.x) +'<br/>'+
                        '<b>Latency:</b> '+Highcharts.numberFormat(this.y, 2) + ' seconds';
                }
            },
            legend: {
                enabled: true
            },
            exporting: {
                enabled: false
            },
            series: [{
                name: 'Latency',
                data: data_latency
            }],
            plotOptions: {
                spline: {marker: {enabled: false}}
            }
        });
    });

});