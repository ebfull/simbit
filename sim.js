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
		var privateBlockchain = this.blockchain.newChainstate();
		var lead = [];
		var state = 0;

		this.explicitRelay = true;

		this.mine(0.3, function() {
			this.log("mine cb()")
			var publicHead = this.blockchain.chainstate.head;
			var privateHead = privateBlockchain.head;

			if (publicHead.h == privateHead.h) {
				if (publicHead != privateHead) {
					this.log("propagating entire lead")
					// We need to propagate our entire lead.
					lead.forEach(function(b) {
						this.inventory.relay(b.id);
					}, this)

					lead.length = 0;
					state = 0;

					// We also need to forcefully apply our private chainstate to the public one.
					var cur = privateHead;
					while (cur) {
						if (this.blockchain.chainstate.enter(cur, true) != -1) {
							break;
						}

						cur = cur._prev();
					}
				}
			} else {
				if (publicHead.h > privateHead.h) {
					this.log("forcefully adopting chainstate")
					// We're behind, just forcefully adopt the public chainstate.

					var cur = publicHead;
					while (cur) {
						// try adding to the chainstate until we succeed at some height
						// the proceeding blocks will arrive from mapOrphans automatically
						if (privateBlockchain.enter(cur) != -1) {
							break;
						}

						lead.length = 0;
						state = 0;

						cur = cur._prev();
					}
				} else if (privateHead.h > publicHead.h) {
					// We're ahead, but by how much?

					var ahead = privateHead.h - publicHead.h;

					if (ahead == 1) {
						if (state == 0) {
							this.log("ignoring 1 lead")
							// We're ahead by one, for the first time, so we'll wait and see if we can catch a block.
							state = 1;
						} else {
							this.log("propagating everything as we're close to losing our lead")
							// We're only ahead by one now. Let's just propagate everything.
							lead.forEach(function(b) {
								this.inventory.relay(b.id);
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
								this.blockchain.chainstate.enter(b);
								this.inventory.relay(b.id);
								spliceOut++;
								return false;
							} else if (b.h == publicHead.h) {
								this.blockchain.chainstate.enter(b);
								this.inventory.relay(b.id);
								spliceOut++;
								return true;
							}
							return true;
						}, this)

						this.log("propagated " + spliceOut + " of our " + lead.length + " lead (public is at " + publicHead.h + ")")

						lead.splice(0, spliceOut);
					}
				} else {
					console.log("SHOULD NOT HAPPEN")
				}
			}

			var newb = new this.blockchain.Block(privateBlockchain.head, this.now(), this);

			return newb;
		})

		this.on("miner:success", function(from, b) {
			b.time = this.now();

			// Don't relay block yet.
			this.inventory.createObj("block", b)

			// The miner succeeded in mining a block.
			privateBlockchain.enter(b);

			// Record the block.
			lead.push(b);

			return false; // hook the functionality of the blockchain
		})
	} else {
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