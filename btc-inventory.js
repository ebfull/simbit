/*
	btc-inventory

	Mimics the Bitcoin inventory system.
*/

function InventoryObject(type, obj) {
	this.type = type;
	this.obj = obj;
	this.name = obj.id;
	this.id = obj.id;
}

InventoryObject.prototype = {
	STATE_NONE: 0,
	STATE_SEEN: 1,
	STATE_RELAY: 2,

	init: function(consensus) {
		consensus.add(this.id, this);
	},

	seen: function(me) {
		var ir = me.get(this.id);

		if (ir.state == this.STATE_NONE) {
			var nid = me.xor(me.group.id, this.id);
			if (me.shift(nid))
				return true;

			me.set(this.id, {state:this.STATE_SEEN})

			return true;
		}

		return false;
	},

	relay: function(me) {
		var ir = me.get(this.id);

		if (ir.state == this.STATE_SEEN) {
			var nid = me.xor(me.group.id, this.id); // remove STATE_SEEN from the state
			nid = me.xor(nid, me.rot(this.id, 1)) // STATE_RELAY is a bitwise rotation left of STATE_SEEN
			if (me.shift(nid))
				return true;

			me.set(this.id, {state:this.STATE_RELAY})

			return true;
		}

		return false;
	}
}

function Inventory(self) {
	self.inventory = this;

	this.polling = false;

	this.objects = self.network.shared("inventory").obtain();

	this.peerHas = {};
	this.tellPeer = {};
	this.mapAskFor = {};
	this.mapAlreadyAskedFor = {};

	this.addTick = function() {
		if (!this.polling) {
			this.polling = true;

			self.tick(1000, this.invTick, this)
		}
	}

	this.invTick = function() {
		var doneSomething = false;

		for (var p in this.tellPeer) {
			var invPacket = this.tellPeer[p];

			if (Object.keys(invPacket) != 0) {
				doneSomething = true;
				this.__send_inv(p, invPacket)

				this.tellPeer[p] = {}; // don't need to tell the peer that anymore
			}
		}

		var askMap = {};
		for (var p in this.peerHas) {
			askMap[p] = [];
		}

		for (var p in this.mapAskFor) {
			for (name in this.mapAskFor[p]) {
				if (this.mapAskFor[p][name] <= self.now()) {
					askMap[p].push(name);
					delete this.mapAskFor[p][name]
				}
			}
		}

		for (var p in askMap) {
			if (askMap[p].length == 0)
				continue;

			doneSomething = true;

			this.__send_getdata(p, askMap[p])
		}

		if (!doneSomething) {
			this.polling = false; // we don't need to poll again
			return false; // don't tick again
		}
	}

	/*
		p, {name1: type1, name2: type2, ...}
	*/
	this.__send_inv = function(p, mapNameTypes) {
		self.peermgr.send(p, "inv", mapNameTypes);
	}

	/*
		p, [name1, name2, name3]
	*/
	this.__send_getdata = function(p, askList) {
		self.peermgr.send(p, "getdata", askList);
	}

	/*
		p, (InventoryObject) o
	*/
	this.__send_invobj = function(p, o) {
		self.peermgr.send(p, "invobj", o);
	}

	this.relay = function(name) {
		var ir = this.objects.get(name);

		if (ir.relay(this.objects)) {
			for (var p in this.tellPeer) {
				this.addTick();
				this.tellPeer[p][name] = ir.type;
			}
		}
	}

	this.getObj = function(name) {
		var ir = this.objects.get(name);

		if (ir.state == ir.STATE_NONE)
			return false;

		return ir.__proto__;
	}

	this.onGetdata = function(from, msg) {
		msg.forEach(function(name) {
			if (o = this.getObj(name)) {
				this.__send_invobj(from, o);
			}
		}, this)
	}

	this.onInv = function(from, msg) {
		for (var name in msg) {
			// do we already have it? then we don't care
			if (this.getObj(name)) {
				// we already have it, so who cares
			} else {
				// start asking for it
				// and record who has it
				this.peerHas[from][name] = msg[name]

				if (!(name in this.mapAlreadyAskedFor)) {
					this.mapAlreadyAskedFor[name] = self.now();
				} else {
					this.mapAlreadyAskedFor[name] += 2 * 60 * 1000;
				}
				this.mapAskFor[from][name] = this.mapAlreadyAskedFor[name];
				this.addTick()
			}
		}
	}

	this.onInvobj = function(from, o) {
		// add it
		if (this.addObj(o)) {
			// stop asking other peers for it (if we are)
			delete this.mapAlreadyAskedFor[o.name]

			for (var p in this.mapAskFor) {
				delete this.mapAskFor[p][o.name]
			}

			// we no longer care that our peers have this object
			for (var p in this.peerHas) {
				delete this.peerHas[p][o.name]
			}

			// now run a handler
			self.handle(from, "inv:" + o.type, o.obj)
		}
	}

	this.addObj = function(obj) {
		var ir = this.objects.get(obj.name);
		if (ir.state == ir.STATE_NONE) {
			obj.seen(this.objects);

			return true;
		}

		return false;
	}

	// obj must have `name` property
	this.createObj = function(type, obj) {
		var o = new InventoryObject(type, obj);

		this.objects.create(o);
		this.addObj(o);

		return o;
	}

	self.on("peermgr:connect", function(from) {
		this.peerHas[from] = {};
		this.tellPeer[from] = {};
		this.mapAskFor[from] = {};

		// todo: send full inventory
	}, this)

	self.on("peermgr:disconnect", function(from) {
		delete this.peerHas[from]
		delete this.tellPeer[from]
		delete this.mapAlreadyAskedFor[from]
	}, this)

	self.on("inv", this.onInv, this)
	self.on("getdata", this.onGetdata, this)
	self.on("invobj", this.onInvobj, this)
	this.addTick();
}

module.exports = Inventory;