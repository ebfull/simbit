var net = require("./network"),
    peermgr = require("./peermgr"),
	client = new net.Node()

client.use(peermgr)

net.add(100, client)
net.run(100 * 1000)