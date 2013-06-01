http = require('http')
port = process.env.PORT || 1337

process.requestsServed = 0

server = http.createServer( (req, res) ->
  res.writeHead(200, 'Content-Type': 'text/plain')
  res.end("Sandbag has served #{process.requestsServed} requests.\n")
  process.requestsServed += 1
)

server.listen(port)
