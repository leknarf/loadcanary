express = require 'express'

exports.application = app = express()
app.requestsServed = 0

app.get '/', (req, res) ->
  res.send "Sandbag has served #{app.requestsServed} requests.\n"
  app.requestsServed += 1
