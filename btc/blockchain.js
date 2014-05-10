/*
	btc-blockchain
*/

var colors = ["green", "orange", "blue", "purple", "brown", "steelblue", "red"]
var color_i = 0;

function Block(prev, time, miner) {
	this.__prev = prev;

	this.transactions = [];

	if (miner) {
		this.credit = miner.id;
		this.transactions = miner.mempool.getList();
	}
	else
		this.credit = false;

	this.time = time;
	this.color = colors[++color_i % colors.length]

	if (prev) {
		this.id = miner.network.rand();
		this.h = prev.h + 1;
		this.prev = prev.id;
		this.difficulty = prev.difficulty;
		this.work = prev.work + prev.difficulty;

		if (!(this.h % this.difficulty_adjustment_period)) {
			this.difficultyAdjustment()
		}
	}
	else {
		//this.id = String.fromCharCode(252, 124, 195, 233, 126, 94, 182, 200, 23, 107, 236, 43, 77, 137);
		this.id = 'xxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
		    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
		    return v.toString(16);
		});
		this.h = 0;
		this.prev = false;
		this.difficulty = 600000;
		this.work = 0;
	}
}

function PrevState(status) {
	this.status = status;

	this.equals = function(v) {
		return (v.status == this.status)
	}
}

var GenesisBlock = new Block(false, 0);

Block.prototype = {
	target_avg_between_blocks: 10 * 60 * 1000,
	difficulty_adjustment_period: 2016,

	difficultyAdjustment: function() {
		var total = 0;
		var last = this.time;
		var cur = this._prev();

		for (var i=0;i<this.difficulty_adjustment_period;i++) {
			total += last - cur.time;
			last = cur.time;
			cur = cur._prev()
		}
		var avg = total / this.difficulty_adjustment_period;

		var old = this.difficulty;
		this.difficulty *= this.target_avg_between_blocks / avg;

		console.log("(h=" + this.h + ") difficulty adjustment " + (this.target_avg_between_blocks / avg) + "x")
	},
	_prev: function() {
		return this.__prev;
	},

	addPrev: function(me) {
		me.set(this.id, new PrevState("set"))
	},

	rmPrev: function(me) {
		me.set(this.id, new PrevState("none"))
	}
}

function MapOrphanBlocks(self) {
	this.mapOrphans = [];
	this.mapOrphansByPrev = {};
}

MapOrphanBlocks.prototype = {
	add: function(b) {
		if (this.mapOrphans.indexOf(b) != -1)
			return false;

		if (this.mapOrphans.length == 100) {
			this.delete(this.mapOrphans[0]);
		}

		this.mapOrphans.push(b);

		if (!(b._prev().id in this.mapOrphansByPrev)) {
			this.mapOrphansByPrev[b._prev().id] = [];
		}
		this.mapOrphansByPrev[b._prev().id].push(b);

		return true;
	},

	delete: function(b) {
		if (this.mapOrphans.indexOf(b) == -1)
			return false;

		var removed = this.mapOrphans.splice(this.mapOrphans.indexOf(b), 1)
		var m = this.mapOrphansByPrev[b._prev().id];
		
		m.splice(m.indexOf(b), 1);

		if (m.length == 0) {
			delete this.mapOrphansByPrev[b._prev().id]
		}

		return true;
	},

	// returns boolean whether the block is an orphan already
	is: function(b) {
		if (this.mapOrphans.indexOf(b) == -1)
			return false;

		return true;
	},

	// finds any blocks that depended on this block within this maporphans
	getForPrev: function(prev) {
		if (prev.id in this.mapOrphansByPrev) {
			return this.mapOrphansByPrev[prev.id];
		}

		return [];
	}
}

var GenesisBlock = new Block(false, 0);

function Chainstate(head, self) {
	this.self = self;

	this.prevs = self.network.shared("chainstate_prevs");

	this.mapOrphans = new MapOrphanBlocks(self);

	this.forward(head)
}

Chainstate.prototype = {
	forward: function(b) {
		this.self.setColor(b.color)
		this.head = b

		this.head.transactions.forEach(function(tx) {
			// transaction _must_ be entered into UTXO to advance to this state
			this.self.transactions.enter(tx, true);

			// transaction must be removed from mempool
			this.self.mempool.remove(tx);
		}, this);
		
		b.addPrev(this.prevs);

		if (this.mapOrphans.delete(this.head))
			this.self.inventory.relay(this.head.id);
	},
	reverse: function() {
		this.head.transactions.forEach(function(tx) {
			// transaction must be added back to mempool
			this.self.mempool.add(tx);
		}, this);

		this.mapOrphans.add(this.head)

		this.head.rmPrev(this.prevs);

		this.head = this.head._prev()
	},
	// (recursively) resolves the best orphan branch for comparison with the chainstate head
	getOrphanWorkPath: function(block) {
		var works = [];

		this.mapOrphans.getForPrev(block).forEach(function(sub) {
			works.push(this.getOrphanWorkPath(sub))
		}, this)

		if (works.length == 0) {
			// there aren't any subworks
			return {end:block,work:block.work}
		} else {
			// pick the largest one
			var largestWork = {end:false,work:Number.NEGATIVE_INFINITY};

			works.forEach(function(subwork) {
				if (subwork.work > largestWork.work) {
					largestWork = subwork;
				}
			})

			// return it
			return largestWork;
		}
	},
	// this function helps identify orphan blocks
	reorg: function(block, numorphan, force) {
		var ourorphans = 0;
		if (numorphan == -1) {
			// This block couldn't be entered into the chainstate, so it's an orphan.
			if (!this.mapOrphans.is(block)) {
				this.mapOrphans.add(block)
			} else {
				return numorphan;
			}
		}

		// maybe it completes a chain though
		var cur = block;

		while(true) {
			var curprev = this.prevs.get(cur.id);
			if (curprev.status == "set") {
				var bestOrphanPath = this.getOrphanWorkPath(cur)
				if ((force && bestOrphanPath.work >= this.head.work) || bestOrphanPath.work > this.head.work) {
					//console.log(this.self.id + ": adopting orphan chain of (w=" + bestOrphanPath.work + " vs. local " + this.head.work + ")")
					ourorphans += this.enter(bestOrphanPath.end, true, true)
				}

				break;
			} else {
				cur = cur._prev();
			}
		}
		if (numorphan == -1) {
			if (ourorphans == 0)
				return numorphan;
			else
				return ourorphans
		}
		else
			return numorphan + ourorphans;
	},
	// enter a block into the chainstate, perhaps resulting in a reorg, and also perhaps resulting in its inclusion within maporphans
	enter: function(block, force, doingReorg) {
		//console.log((doingReorg ? "(reorg) " : "") + "entering new block at height " + block.h)
		if (block == this.head)
			return -1

		var bprev = this.prevs.get(block._prev().id)

		if (bprev.status == "none") {
			// this block's prev doesn't exist, it's an orphan!
			if (!doingReorg)
				return this.reorg(block, -1, force)
		}

		if (typeof force == "undefined")
			force = false;
		//else if (force)
		//	this.self.log("\tchainstate forcefully entering branch")

		var numorphan = -1;

		if ((this.head.work < block.work) || force) {
			// the current head is now obsolete

			numorphan = 0;
			var forwards = []
			var cur = block

			reorg:
			while(true) {
				if (cur.h > this.head.h) {
					forwards.push(cur)
					cur = cur._prev()
				} else if (cur == this.head) {
					while(true) {
						if (forwards.length > 0) {
							this.forward(forwards.pop())
						} else {
							break reorg;
						}
					}
				} else {
					numorphan++;
					this.reverse()
				}
			}
		} else if (this.head.work == block.work) {
			//this.self.log("\tblock rejected; already seen one at this chainlength")
		}

		if (!doingReorg)
			numorphan = this.reorg(block, numorphan)

		return numorphan
	}
}

function Blockchain(self) {
	self.blockchain = this;

	this.chainstate = new Chainstate(GenesisBlock, self);

	this.newChainstate = function() {
		return new Chainstate(this.chainstate.head, self);
	}

	// When we receive a new block over the wire, process it here.
	this.onBlock = function(b) {
		if (this.chainstate.enter(b) != -1) {
			self.inventory.relay(b.id);
			return true;
		};
	}

	self.on("obj:block", function(from, o) {
		if (this.onBlock(o))
			self.handle(from, "blockchain:block", o);
	}, this)
}

Blockchain.prototype = {
	Block: Block,
	GenesisBlock: GenesisBlock
}

module.exports = Blockchain;