function PoolTxState(status) {
	this.status = status;

	this.equals = function(v) {
		return this.status == v.status;
	}
}

function PoolTx(tx) {
	this.tx = tx;
}

PoolTx.prototype = {
	init: function(consensus) {
		consensus.add(this.tx.id, this.tx);
	},

	exists: function(me) {
		var ir = me.get(this.tx.id);

		if (ir.status == "none") {
			me.set(this.tx.id, new PoolTxState("exist"))

			return true;
		}

		return false;
	},

	noexists: function(me) {
		var ir = me.get(this.tx.id);

		if (ir.status == "exist") {
			me.set(this.tx.id, new PoolTxState("none"))

			return true;
		}

		return false;
	}
}

function Mempool(self) {
	self.mempool = this;

	this.pool = self.network.shared("Mempool");

	this.add = function(tx) {
		var n = new PoolTx(tx);
		this.pool.create(n);

		return n.exists(this.pool);
	}

	this.remove = function(tx) {
		var n = new PoolTx(tx);
		this.pool.create(n);

		return n.noexists(this.pool);
	}

	this.getList = function() {
		return this.pool.find({status:"exist"});
	}
}

module.exports = Mempool;