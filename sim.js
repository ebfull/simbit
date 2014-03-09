var net = require("./network"),
    peermgr = require("./peermgr"),
	client = new net.Node()

client.use(peermgr)

client.init(function() {
	this.tick(1000, function () {
		// every second we'll broadcast a ping message to our peers, containing a timestamp
		this.peermgr.broadcast("ping", this.now());
	})

	this.on("ping", function(from, time) {
		// we received a ping message (courtesy of peermgr)
		this.peermgr.send(from, "pong", time); // send back a pong
	})

	this.on("pong", function(from, time) {
		// we received a pong message from another peer
		this.log("roundtrip: " + (this.now() - time))
	})
})

net.add(100, client)
net.run(100 * 1000)