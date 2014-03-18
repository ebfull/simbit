/*
	Selfish Mining Attack Simulation
*/

var net = require("./network"),
    peermgr = require("./peermgr"),
    btc = require("./btc"),
	client = new net.Node()

client.use(peermgr)
client.use(btc)

client.init(function() {
	if (this.id == 0) { // node 0 is the selfish miner
	//if (false) {
		this.peermgr.maxpeers = 99;
		var lead = [];
		var state = 0;

		this.mine(0.3, function() {
			var publicHead = this.blockchain.chainstate.head;
			var privateHead;
			if (lead.length == 0) {
				privateHead = publicHead;
			} else {
				privateHead = lead[lead.length - 1]
			}

			if (publicHead.h == privateHead.h) {
				if (publicHead != privateHead) {
					this.log("propagating entire private chain (" + lead.length + " blocks)")

					// We need to propagate our entire lead.
					lead.forEach(function(b) {
						this.inventory.relay(b.id, true);
						this.blockchain.chainstate.enter(b, true);
					}, this)

					lead.length = 0;
					state = 0;
				}
			} else {
				if (publicHead.h > privateHead.h) {
					this.log("adopting public chain")
					lead.length = 0;
					state = 0;

					privateHead = publicHead;
				} else if (privateHead.h > publicHead.h) {
					// We're ahead, but by how much?

					var ahead = privateHead.h - publicHead.h;

					if (ahead == 1) {
						if (state == 0) {
							this.log("ignoring 1 lead")
							// We're ahead by one, for the first time, so we'll wait and see if we can catch a block.
							state = 1;
						} else {
							this.log("lead threatened; propagating entire private chain (" + lead.length + " blocks)")
							// We're only ahead by one now. Let's just propagate everything.
							lead.forEach(function(b) {
								this.inventory.relay(b.id, true);
								this.blockchain.chainstate.enter(b, true);
							}, this)

							lead.length = 0;
							state = 0;
						}
					} else {
						// We're ahead by more than one, let's propagate our lead blocks UNTIL we reach the public
						// chainstate's head.

						var spliceOut = 0;

						lead.some(function(b) {
							if (b.h < publicHead.h) {
								this.inventory.relay(b.id, true);
								this.blockchain.chainstate.enter(b);
								spliceOut++;
								return false;
							} else if (b.h == publicHead.h) {
								this.inventory.relay(b.id, true);
								this.blockchain.chainstate.enter(b);
								spliceOut++;
								return true;
							}
							return true;
						}, this)

						this.log("propagated " + spliceOut + " of our " + lead.length + " lead (public is at " + publicHead.h + ")")

						lead.splice(0, spliceOut);
					}
				}
			}

			var newb = new this.blockchain.Block(privateHead, this.now(), this);

			return newb;
		})

		this.on("miner:success", function(from, b) {
			b.time = this.now();

			// Don't relay block yet.
			this.inventory.createObj("block", b)

			// Record the block.
			lead.push(b);

			return false; // hook the functionality of the blockchain
		})
	} else {
		if (this.id == 0) {
			this.peermgr.maxpeers = 99;
			this.mine(0.3);
		}
		else
			this.mine((1-0.3)/99)
	}
})

net.add(100, client)
net.check(10000 * 1000, function() {
	net.nodes[90].blockchain.chainstate.head;

	var cur = net.nodes[90].blockchain.chainstate.head;

	var totalH = cur.h;
	var attackerRevenue = 0;

	while (cur) {
		if (cur.credit == 0)
			attackerRevenue++;

		cur = cur._prev();
	}

	net.visualizer.log("Attacker revenue: " + ((attackerRevenue / totalH) * 100).toFixed(2) + "; h=" + totalH)
})
net.run(Infinity)