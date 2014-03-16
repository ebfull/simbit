function Miner(self) {
	self.miner = this;

	self.mprob = 0;

	this.difficulty = self.blockchain.chainstate.head.difficulty;
	this.enabled = false;

	var updateDifficulty = function () {
		var cur = self.blockchain;

		if (self.miner.difficulty != cur.chainstate.head.difficulty) {
			self.miner.difficulty = cur.chainstate.head.difficulty;

			if (self.miner.enabled) {
				self.miner.stopMining()
				self.miner.startMining()
			}
		}
	}

	// Hook the onBlock routine for the blockchain
	// (to adjust our mining target if necessary)
	var oldNormalOnBlock = self.blockchain.onBlock;
	self.blockchain.onBlock = function(b) {
		oldNormalOnBlock.call(self.blockchain, b)

		updateDifficulty();
	}

	// expose mine() to NodeState
	self.mine = function(amt) {
		this.mprob = amt;

		self.miner.startMining();
	}

	this.stopMining = function() {
		if (!this.enabled)
			return;

		this.enabled = false;
		self.deprob("mining")
	}

	this.startMining = function() {
		if (this.enabled)
			return;

		this.enabled = true;

		if (self.mprob) {
			var cur = self.blockchain;

			self.prob("mining", self.mprob / cur.chainstate.head.difficulty, function() {
				cur.onMine()

				updateDifficulty()

				self.log("[" + self.now() + "]: " + self.id + ": mined block at h=" + cur.chainstate.head.h)
			}, this)
		}
	}
}

module.exports = Miner;