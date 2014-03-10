/*
	Example: Alert Message

	An alert message needs to be broadcasted to all nodes as fast as possible!

	Let's calculate how long it takes the message to be received by all nodes.
*/


var net = require("./network"),
    peermgr = require("./peermgr"),
	client = new net.Node()

client.use(peermgr)

client.init(function() {
	this.alertflag = false;

	if (this.id == 0) {
		this.delay(20000, function() {
			this.log("dispatching alert")
			// give the network about 20 seconds so everybody is connected

			this.alertflag = true;
			this.setColor("red")

			this.peermgr.broadcast("alert")
		})
	}

	this.on("alert", function() {
		if (this.alertflag)
			return;

		this.alertflag = true;
		this.setColor("red")
		this.peermgr.broadcast("alert")
	})
})

net.add(100, client)
net.check(20, function() {
	var aware = 0;
	net.nodes.forEach(function(n) {
		if (n.alertflag) {
			aware++;
		}
	})

	if (aware == net.nodes.length) {
		net.visualizer.log(net.now + ": ALL NODES HAVE RECEIVED ALERT MESSAGE");
		net.stop();
	}
})
net.run(Infinity)