/*
	btc-transactions
*/

function TxIn(ref, n) {
	this.ref = ref;
	this.n = n;
	this.k = ref.id + ':' + n;

	this.isvalid = function() {return true;}
}

function TxOut(txid, n) {
	this.n = n;
	this.k = txid + ':' + n;
}

function Transaction(id, inputs, n) {
	this.id = id;
	this.vin = inputs;
	this.vout = [];

	for (var i = 0;i<n;i++) {
		this.vout.push(new TxOut(this.id, i));
	}
}

function MapOrphanTransactions(self) {
	this.mapOrphans = [];
	this.mapOrphansByPrev = {};
}

MapOrphanTransactions.prototype = {
	add: function(b) {
		if (this.mapOrphans.indexOf(b) != -1)
			return false;

		if (this.mapOrphans.length == 100) {
			this.delete(this.mapOrphans[0]);
		}

		this.mapOrphans.push(b);

		b.vin.forEach(function(input) {
			if (!(input.k in this.mapOrphansByPrev))
				this.mapOrphansByPrev[input.k] = []

			this.mapOrphansByPrev[input.k].push(b)
		}, this)

		return true;
	},

	delete: function(b) {
		if (this.mapOrphans.indexOf(b) == -1)
			return false;

		var removed = this.mapOrphans.splice(this.mapOrphans.indexOf(b), 1)

		b.vin.forEach(function(input) {
			var m = this.mapOrphansByPrev[input.k];

			m.splice(m.indexOf(b), 1);

			if (m.length == 0) {
				delete this.mapOrphansByPrev[input.k]
			}
		}, this)

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
		var ret = [];

		prev.vout.forEach(function(output) {
			if (output.k in this.mapOrphansByPrev) {
				ret = ret.concat(this.mapOrphansByPrev[output.k]);
			}
		}, this)

		return ret;
	}
}

function TransactionState(status, spentBy, spentByN) {
	this.status = status;
	this.spentBy = spentBy;
	this.spentByN = spentByN;

	this.equals = function(v) {
		switch (v.status) {
			case "spent":
				if (this.status == "spent") {
					if ('spentBy' in v) {
						if (this.spentBy == v.spentBy) {
							if ('spentByN' in v) {
								if (this.spentByN == v.spentByN) {
									return true;
								}
							}
						}
					}
				}
			break;
			default:
				if (v.status == this.status)
					return true;
			break;
		}

		return false;
	}
}

// Transaction validator:
function TransactionValidator(tx) {
	this.tx = tx;
	this.state = this.DEFAULT;
	this.conflicts = [];
}

TransactionValidator.prototype = {
	DEFAULT: 0,
	ORPHAN: 1,
	CONFLICT: 2,
	INVALID: 3,
	VALID: 4,

	clean: function() {
		var newConflicts = [];

		this.conflicts.forEach(function(c) {
			if (newConflicts.indexOf(c) == -1) {
				newConflicts.push(c);
			}
		})

		this.conflicts = newConflicts;
	},

	// apply a transaction to the state
	apply: function(me) {
		if (this.state != this.VALID) {
			return false;
		}

		// remove all conflicting transactions
		this.conflicts.forEach(function(ctx) {
			ctx.remove(me);
		}, this)

		// Now, spend our inputs...
		var spentByN = 0;

		this.tx.vin.forEach(function(input) {
			me.set(input.k, new TransactionState("spent", this.tx, spentByN))
			spentByN++;
		}, this);

		// Now, set our outputs as unspent...
		this.tx.vout.forEach(function(output) {
			me.set(output.k, new TransactionState("unspent"))
		}, this);
	},

	unapply: function(me) {
		if (this.state != this.VALID)
			return false;

		// remove child transactions
		this.conflicts.forEach(function(ctx) {
			ctx.remove(me);
		}, this)

		this.tx.remove(me);
	}
};

Transaction.prototype = {
	in: function(n) {
		return new TxIn(this, n);
	},

	init: function(consensus) {
		var n = 0;

		this.vout.forEach(function(output) {
			consensus.add(this.id + ':' + output.n, output);
		}, this);
	},

	validate: function(me) {
		// Check if a transaction is valid given state `me`.

		var fin = new TransactionValidator(this);

		this.vin.forEach(function(input) {
			// Check if we have the input in our UTXO

			var ir = me.get(input.k);

			switch (ir.status) {
				case "none":
					if (fin.state == fin.DEFAULT) {
						fin.state = fin.ORPHAN; // This input is not in our UTXO.
					}
				break;
				case "spent":
					if (fin.state < fin.INVALID) {
						fin.state = fin.CONFLICT; // This input has been spent, and so this tx conflicts with another.

						var sub = ir.spentBy.invalidate(me);

						fin.conflicts.concat(sub.conflicts);
						fin.conflicts.push(ir.spentBy);
					}
				break;
			}

			if (!input.isvalid()) {
				fin.state = fin.INVALID; // This input is not valid. (Script failed?)
			}
		}, this)

		if (fin.state == fin.DEFAULT)
			fin.state = fin.VALID; // If we didn't run into problems, tx is valid.

		fin.clean();

		return fin;
	},

	invalidate: function(me) {
		var fin = new TransactionValidator(this);

		var fault = false;

		this.vin.forEach(function(input) {
			var ir = me.get(input.k);

			if ((ir.status != "spent") || (ir.spentBy != this)) {
				fault = true;
			}
		}, this)

		if (fault) {
			fin.state = fin.INVALID;
			return fin;
		}

		this.vout.forEach(function(output) {
			var ir = me.get(output.k);

			if (ir.status == "spent") {
				var sub = ir.spentBy.invalidate(me);

				fin.conflicts.concat(sub.conflicts);
				fin.conflicts.push(ir.spentBy);
			}
		}, this)

		fin.state = fin.VALID;

		return fin;
	},

	remove: function(me) {
		// delete all outputs
		this.vout.forEach(function(output) {
			me.set(output.k, new TransactionState("none"))
		}, this);

		// set all inputs as unspent (if they weren't already purged)
		this.vin.forEach(function(input) {
			var cir = me.get(input.k)

			if (cir.status == "spent")
				me.set(input.k, new TransactionState("unspent"));

		}, this);
	},
};

function Transactions(self) {
	self.transactions = this;

	this.UTXO = self.network.shared("UTXO");
	this.mapOrphans = new MapOrphanTransactions(self);

	this.create = function(inputs, n) {
		var nid = this.UTXO.rand();

		var tx = new Transaction(nid, inputs, n);

		this.UTXO.create(tx);

		return tx;
	}

	// tries to add transactions which this tx may have 
	this.processOrphans = function(tx) {
		// find any tx in mapOrphans which spends from our TxOuts

		var descend = this.mapOrphans.getForPrev(tx);

		descend.forEach(function(sub) {
			if (this.mapOrphans.is(sub) && this.enter(sub)) {
				self.log("removed tx from mapOrphans")
				self.inventory.relay(sub.id)
				this.processOrphans(sub)
			}
		}, this)
	}

	// attempts to enter tx into utxo/mempool/maporphans
	// returns bool whether we accepted it, and it should be relayed
	this.enter = function(tx, force) {
		var val = tx.validate(this.UTXO);

		if (force && val.state == val.CONFLICT)
			val.state = val.VALID;

		switch (val.state) {
			case val.INVALID:
				self.log("rejected tx, invalid")
				return false;
			break;
			case val.ORPHAN:
				this.mapOrphans.add(tx);
				self.log("rejected tx, added to mapOrphans")
				return false;
			break;
			case val.CONFLICT:
				self.log("rejected tx, double-spend")
				return false;
			break;
			case val.VALID:
				val.apply(this.UTXO); // add to UTXO
				this.processOrphans(tx);
				return true;
			break;
		}
	}

	self.on("obj:tx", function(from, tx) {
		self.log("Transactions: received tx " + tx.id)
		if (this.enter(tx)) {
			self.inventory.relay(tx.id)
		}
	}, this)
}

module.exports = Transactions;