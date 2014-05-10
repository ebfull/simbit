/*
	MinCen Simulation
*/

var net = require("./network"),
    peermgr = require("./peermgr"),
    btc = require("./btc"),
	client = new net.Client()

btc.Blockchain.Block.prototype.target_avg_between_blocks = 60 * 1000; // one minute blocks
btc.Blockchain.GenesisBlock.difficulty = 3700;

client.use(peermgr)
client.use(btc)

var selfishHashrate = 0.3;

client.init(function() {
	var self = this;

	var mapMasters = {};
	mapMasters[this.id] = {num:10, last:-1};
	var shares = [];
	var shareh = -1;
	var master = this.id;
	var signedByPrev = {};

	var pickMaster = function() {
		var best = -1;
		var bestn = 0;

		for (m in mapMasters) {
			var _master = mapMasters[m];

			if (_master.last < (self.miner.staged.h - 10))
				continue;

			if (_master.num > bestn) {
				bestn = _master.num;
				best = m;
			}
		}

		if (best == -1) {
			best = self.id;
		}

		if (master != best) {
			shares = [];
			master = best;
		}
	}

	this.miner.restage = function() {
		if (self.miner.staged.h != self.miner.shareh) {
			shareh = self.miner.staged.h;
			shares = [];
		}

		self.miner.difficulty = self.miner.staged.difficulty;
		if (self.miner.enabled) {
			self.miner.stopMining()
			self.miner.startMining()
		}
	}

	self.on("miner:success", function(from, b) {
		b.time = self.now();
		b.transactions = self.mempool.getList();
		pickMaster();
		b.master = master;
		b.winner = Math.random() < (1/16); // 1/16 chance of being the block winner
		b.shares = shares.slice(0, 15); // 16 shares max

		if (b.winner) {
			self.log("WINNER (" + b.id +  ") at h=" + b.h);

			if (b.master == self.id) {
				self.log("<span style='color:red'>MASTER SIGN WINNER</span> (" + b.id + ") at h=" + b.h)

				self.inventory.createObj("block", b);
				self.inventory.relay(b.id, true);

				self.blockchain.chainstate.enter(b);
			} else {
				self.inventory.createObj("unsignedblock", {id:"unsigned_" + b.id, b:b})
				self.inventory.relay("unsigned_" + b.id, true);
			}
		} else {
			self.log("SHARE (" + b.id + ") at h=" + b.h);
			
			if (b.master == self.id) {
				self.log("MASTER SIGN SHARE (" + b.id + ") at h=" + b.h)

				self.inventory.createObj("shareack", {id:"ack_" + b.id, share:b, master:self.id});

				self.inventory.relay("ack_" + b.id, true);
			} else {
				self.inventory.createObj("share", {id:"share_" + b.id, share:b});

				self.inventory.relay("share_" + b.id, true);
			}
		}



		return false; // hook the default miner code
	}, this.miner)

	self.on("obj:share", function(from, share) {
		if (share.share.master == self.id) {
			self.log("MASTER SIGN SHARE (" + share.share.id + ") at h=" + share.share.h)
			// that's us! sign it
			self.inventory.createObj("shareack", {id:"ack_" + share.share.id, share:share.share, master:self.id});

			self.inventory.relay("ack_" + share.share.id, true);
		} else {
			if (share.share.h == this.staged.h) {
				self.inventory.relay(share.id, true);
			}
		}
	}, this.miner)

	self.on("obj:shareack", function(from, ack) {
		if (ack.share.h == this.staged.h) {
			self.inventory.relay(ack.id, true);

			var share = ack.share;

			if (!(share.master in mapMasters)) {
				mapMasters[share.master] = {num:0,last:0};
			}

			mapMasters[share.master].num++;
			mapMasters[share.master].last = share.h;

			if (share.master == master) {
				shares.push(share);
			}

			pickMaster();
		}
	}, this.miner)

	self.on("obj:unsignedblock", function(from, ub) {
		if (ub.b.master == self.id) {
			// that's us! sign it, if we haven't already signed another block with this prev
			if (!(ub.b.prev in signedByPrev)) {

				self.log("<span style='color:red'>MASTER SIGN WINNER</span> (" + ub.b.id + ") at h=" + ub.b.h);

				signedByPrev[ub.b.prev] = true;

				self.inventory.createObj("block", ub.b);

				self.inventory.relay(ub.b.id, true);

				self.blockchain.chainstate.enter(ub.b);
			}
		} else {
			// just relay it
			self.inventory.relay(ub.id, true);
		}
	}, this.miner)
////////////////////////////////////////////////
	this.mine(0.01);
})

net.add(100, client)
net.run(Infinity)