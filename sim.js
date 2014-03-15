var net = require("./network"),
    peermgr = require("./peermgr"),
    inventory = require("./btc-inventory"),
    transactions = require("./btc-transactions"),
	client = new net.Node()

client.use(peermgr)
client.use(inventory)
client.use(transactions)

client.init(function() {
	if (this.id == 0) {

		this.delay(30000, function() {
			var tx = this.transactions.create([], 3);

			console.log(tx)

			var inv = this.inventory.createObj("tx", tx);

			this.inventory.relay(inv.id);
		})
	}

	this.on("inv:tx", function(from, tx) {
		this.log(":)")
		this.inventory.relay(tx.id)
	})
})

net.add(100, client)
net.run(Infinity)