var net = require("./network"),
    peermgr = require("./peermgr"),
    btc = require("./btc"),
	client = new net.Node()

client.use(peermgr)
client.use(btc)

client.init(function() {
	this.mine(0.01);
})

net.add(100, client)
net.run(Infinity)