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

	id: function(me) {
		var cur = me.group.id;

		cur = me.xor(cur, this.tx.id);

		this.conflicts.forEach(function(c) {
			cur = me.xor(cur, c.id);
		})

		return cur;
	},

	// apply a transaction to the state
	// todo prevent duplicates?
	apply: function(me) {
		if (this.state != this.VALID) {
			return false;
		}

		// let's move to a new state group
		if (me.shift(this.id()))
			return; // using cached shift

		// remove all conflicting transactions
		this.conflicts.forEach(function(ctx) {
			ctx.remove(me);
		}, this)

		// Now, spend our inputs...
		var spentByN = 0;

		this.tx.vin.forEach(function(input) {
			me.set(input.k, {state:this.tx.STATE_SPENT, spentBy: this.tx, spentByN: spentByN})
			spentByN++;
		}, this);

		// Now, set our outputs as unspent...
		this.tx.vout.forEach(function(output) {
			me.set(output.k, {state:this.tx.STATE_UNSPENT});
		}, this);
	},

	unapply: function(me) {
		if (this.state != this.VALID)
			return false;

		// move to a new state group
		if (me.shift(this.id()))
			return; // using cached shift

		// remove child transactions
		this.conflicts.forEach(function(ctx) {
			ctx.remove(me);
		}, this)

		this.tx.remove(me);
	}
};

Transaction.prototype = {
	STATE_NONE: 0,
	STATE_UNSPENT: 2,
	STATE_SPENT: 3,

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

			switch (ir.state) {
				case this.STATE_NONE:
					if (fin.state == fin.DEFAULT) {
						fin.state = fin.ORPHAN; // This input is not in our UTXO.
					}
				break;
				case this.STATE_SPENT:
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

			if ((ir.state != this.STATE_SPENT) || (ir.spentBy != this)) {
				fault = true;
			}
		}, this)

		if (fault) {
			fin.state = fin.INVALID;
			return fin;
		}

		this.vout.forEach(function(output) {
			var ir = me.get(output.k);

			if (ir.state == this.STATE_SPENT) {
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
			me.set(output.k, {state:this.STATE_NONE});
		}, this);

		// set all inputs as unspent (if they weren't already purged)
		this.vin.forEach(function(input) {
			var cir = me.get(input.k)

			if (cir.state == this.STATE_SPENT)
				me.set(input.k, {state:this.STATE_UNSPENT});

		}, this);
	}
};

function Transactions(self) {
	self.transactions = this;

	this.UTXO = self.network.shared("UTXO").obtain();

	this.create = function(inputs, n) {
		var nid = this.UTXO.rand();

		var tx = new Transaction(nid, inputs, n);

		this.UTXO.create(tx);

		return tx;
	}
}

module.exports = Transactions;