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
			var child1 = this.transactions.create([tx.in(0)], 3);
			var child2 = this.transactions.create([tx.in(0)], 3);

			//this.transactions.enter(tx);
			//this.transactions.enter(child1);

			//this.inventory.createObj("tx", tx);
			this.inventory.createObj("tx", child1);
			//this.inventory.createObj("tx", child2);

			this.inventory.relay(child1.id);

			this.delay(30000, function() {
				this.transactions.enter(tx);
				this.transactions.enter(child1);

				this.inventory.createObj("tx", tx);

				this.inventory.relay(tx.id)

				this.delay(100000, function() {
					this.inventory.createObj("tx", child2);
					this.inventory.relay(child2.id);
				})
			})
		})
	}
})

net.add(100, client)
net.run(Infinity)