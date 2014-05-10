/*
	Selfish Mining Attack Simulation
*/

var net = require("./network"),
    peermgr = require("./peermgr"),
    btc = require("./btc"),
	client = new net.Client()

client.use(peermgr)
client.use(btc)

var selfishHashrate = 0.3;

client.init(function() {
	if (this.id == 0) {
		this.delay(30000, function() {
			var tx = this.transactions.create([], 1); // create transaction with one output
			var inv = this.inventory.createObj("tx", tx); // create inventory object for the transaction
			this.inventory.relay(tx.id); // relay it now!
		})
	}

	this.mine(0.001);
})

net.add(100, client)
net.run(Infinity)