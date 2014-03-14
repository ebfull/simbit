var net = require("./network"),
    peermgr = require("./peermgr"),
    inventory = require("./btc-inventory"),
	client = new net.Node()

client.use(peermgr)
client.use(inventory)

net.add(100, client)
net.run(Infinity)