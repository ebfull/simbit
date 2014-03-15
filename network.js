if (typeof goog == "undefined") {
	require('./goog/bootstrap/nodejs')
	goog.require("goog.structs.PriorityQueue")
}

var topologySeed = Math.floor(Math.random() * 1000000000);

function latency(a, b) {
	var min = 10 + Math.abs(((a*topologySeed)^(b*topologySeed)) % 300);
	var avgVariance = 15;

	return Math.floor((Math.log(1-Math.random())/-1) * (avgVariance)) + min
}


/*
	Events

	This object is used to coordinate events that occur in the simulation. It is a proxy
	for a priority queue.
*/
function Events() {
	this.heapBuckets = {
		"default":new goog.structs.PriorityQueue(),
		"probs":new goog.structs.PriorityQueue()
	};
}

Events.prototype = {
	add: function(time, event, bucket) {
		if (typeof bucket == "undefined")
			bucket = "default"

		this.heapBuckets[bucket].insert(time, event);
	},

	next: function(maxtime) {
		var best = Number.POSITIVE_INFINITY;
		var best_bucket = false;

		for (var b in this.heapBuckets) {
			var time = this.heapBuckets[b].peekKey();

			if (typeof time == "undefined")
				continue; // bucket is empty

			if (time < best) {
				best = time;
				best_bucket = b;
			}
		}

		if (!best_bucket)
			return false;

		if (best > maxtime)
			return false;

		return {time:best, event:this.heapBuckets[best_bucket].dequeue()};
	}
}

/*
	Interface:
		run(network) - runs an event against the Network
		delay - msec delay before the event should occur once it is committed to the network

	NodeEvent: runs a function against a node's state
	NodeMessageEvent: triggers a handler against a node's state, follows middleware paths
	NodeTickEvent: a repetitive function ran against a node's state.
		- if the function returns false, we do not run the tick again
		- the return of this function can override the delay if it is a number
	NodeProbabilisticTickEvent: a pool of events that can occur at any time, like mining
*/

function NodeEvent(delay, nid, f, ctx) {
	this.delay = delay;

	this.run = function(network) {
		if (typeof ctx == "undefined")
			ctx = network.nodes[nid]

		f.call(ctx);
	}
}

function NodeMessageEvent(from, nid, name, obj) {
	this.delay = latency(from, nid);

	this.run = function(network) {
		//network.setLinkActivity(from, nid)

		network.nodes[nid].handle(from, name, obj)
	}
}

function NodeTickEvent(delay, nid, f, ctx) {
	this.delay = delay;

	this.run = function(network) {
		var newDelay;
		if (newDelay = f.call(ctx) !== false) {
			if (typeof newDelay == "number")
				this.delay = newDelay;

			network.exec(this)
		}
	}
}

/****
@probability: used to describe probability of event firing every msec
@event: function called
@ctx: function context

NodeProbabilisticTickEvent.ignore is used to disable an event if it's
never going to occur again, thus avoiding a seek and destroy on the 
binary heap.
****/
function NodeProbabilisticTickEvent(probability, event, nid, ctx) {
	// The event will occur in this.delay msec
	this.delay = Math.floor((Math.log(1-Math.random())/-1) * (1 / (probability)));
	this.ignore = false;

	this.run = function(network) {
		if (this.ignore)
			return false;

		if (typeof ctx == "undefined")
			ctx = network.nodes[nid]

		// fire event
		event.call(ctx)

		// new delay
		this.delay = Math.floor((Math.log(1-Math.random())/-1) * (1 / (probability)));

		// create next event
		network.exec(this, "probs")
	}
}

/*
	NodeState

	Has a bunch of helper functions for the node.
*/

function NodeState(node, network, id) {
	this.id = id;
	this.network = network;
	this.handlers = [];

	node.setup(this);
}

NodeState.prototype = {
	prob: function(label, p, f, ctx) {
		this.network.pregister(label, p, this.id, f, ctx)
	},

	deprob: function(label) {
		this.network.depregister(label, this.id)
	},

	setColor: function(color) {
		this.network.setColor(this.id, color);
	},

	connect: function(remoteid) {
		this.network.connect(this.id, remoteid);
	},

	disconnect: function(remoteid) {
		this.network.disconnect(this.id, remoteid);
	},

	log: function(msg) {
		var str = "[" + this.now() + "]: " + this.id + ": " + msg;

		if (this.network.visualizer) {
			this.network.visualizer.log(str)
		} else {
			console.log(str)
		}
	},

	now: function() {
		return this.network.now;
	},

	tick: function(delay, f, ctx) {
		if (typeof ctx == "undefined")
			ctx = this;

		this.network.exec(new NodeTickEvent(delay, this.id, f, ctx))
	},

	send: function(nid, name, obj) {
		this.network.exec(new NodeMessageEvent(this.id, nid, name, obj))
	},

	handle: function(from, name, obj) {
		if (typeof this.handlers[name] != "undefined") {
			return this.handlers[name](from, obj)
		}
	},

	on: function(name, f, ctx) {
		if (typeof ctx == "undefined")
			ctx = this;

		if (typeof this.handlers[name] != "undefined") {
			var oldHandler = this.handlers[name];
			this.handlers[name] = function(from, obj) {if (f.call(ctx, from, obj)) oldHandler.call(from, obj);}
		} else {
			this.handlers[name] = function(from, obj) {return f.call(ctx, from, obj);};
		}
	},

	delay: function(delay, f, ctx) {
		this.network.exec(new NodeEvent(delay, this.id, f, ctx))
	}
}

function Node() {
	this._use = [];
	this._init = false;
}

Node.prototype = {
	setup: function(node) {
		// run middleware
		for (var i=0;i<this._use.length;i++) {
			new this._use[i](node);
		}

		// run init functions
		if (this._init)
			this._init.call(node);
	},

	use: function(f) {
		this._use.push(f);
	},

	init: function(callback) {
		if (!this._init)
			this._init = callback;
		else {
			var oldInit = this._init;
			this._init = function() {oldInit.call(this); callback.call(this)};
		}
	},
}

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function Group(parent) {
	this._r = 0;
	this.states = {};
	this.children = [];

	if (parent) {
		this._r = 1;
		this.consensus = parent.consensus;
		this.parent = parent;
		this.id = parent.id;

		this.parent.children.push(this);
	}
}

Group.prototype = {
	get: function(k) {
		if (k in this.states) {
			return this.states[k];
		} else {
			if (this.parent) {
				return this.parent.get(k);
			} else {
				var base = {state:0};
				base.__proto__ = this.consensus.store[k];
				return base;
			}
		}
	},
	set: function(k, value) {
		value.__proto__ = this.consensus.store[k]; // todo: not sure if this is a good design
		this.states[k] = value;
	},
	inherit: function() {
		// inherit states from our parent
		for (var id in this.parent.states) {
			if (!(id in this.states)) {
				this.states[id] = this.parent.states[id];
			}
		}

		this.parent = this.parent.parent;
	},
	retain: function() {
		this._r++;
	},
	release: function() {
		this._r--;

		if (this._r == 0) {
			// nothing will switch to this state again, remove us from cache
			this.consensus.rmgroup(this);

			// merge upward as much as possible
			while (this.parent && this.parent._r == 0) {
				if (Object.keys(this.parent.states).length <= Object.keys(this.states).length) {
					this.inherit();
				} else {
					break;
				}
			}

			// release our children
			this.children.forEach(function(child) {
				child.release();
			})

			// garbage collect
			this.children = false;
		}
	}
}

function Consensus() {
	this._defaultGroup = this.rand();
	this.store = {}; // key value store for objects themselves
	var defaultGroup = new Group(false);
	defaultGroup.id = this._defaultGroup;
	defaultGroup.parent = false;
	defaultGroup.consensus = this;

	this.groups = {};
	this.groups[this._defaultGroup] = defaultGroup;
}

function LocalizedState(consensus) {
	this.consensus = consensus;
	this.group = consensus.group(consensus._defaultGroup);
	this.group.retain();
	this.id = consensus.rand();
}

Consensus.prototype = {
	group: function(name) {
		if (!(name in this.groups)) {
			return false;
		}

		return this.groups[name];
	},
	newgroup: function(g) {
		this.groups[g.id] = g;
	},
	rmgroup: function(g) {
		if (g.id == this._defaultGroup) // never delete
			return;

		delete this.groups[g.id];
	},
	add: function(key, obj) {
		this.store[key] = obj;
	},
	obtain: function() {
		return new LocalizedState(this);
	},
	rand: function() {
		return String.fromCharCode(
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256),
			Math.floor(Math.random() * 256)
			)
	},
	xor: function(a, b) {
		var n = "";

		for (var i=0;i<a.length;i++) {
			n += String.fromCharCode(a.charCodeAt(i) ^ b.charCodeAt(i));
		}

		return n;
	},
	rot: function(a, k) {
		var n = "";

		for (var i=k;i<a.length;i++) {
			n += String.fromCharCode(a.charCodeAt(i));
		}
		for (var i=0;i<k;i++) {
			n += String.fromCharCode(a.charCodeAt(i));
		}

		return n;
	}
};

LocalizedState.prototype = {
	set: function(k, v) {
		return this.group.set(k, v);
	},
	get: function(k) {
		return this.group.get(k);
	},
	create: function(obj) {
		return obj.init(this.consensus);
	},
	xor: function(a, b) {
		return this.consensus.xor(a, b);
	},
	rot: function(a, k) {
		return this.consensus.rot(a, k);
	},
	shift: function(nid) {
		var nn;
		if (nn = this.consensus.group(nid)) {
			var oldgroup = this.group;
			this.group = nn;
			nn.retain();
			oldgroup.release();
			return true;
		} else {
			var oldgroup = this.group;
			this.group = new Group(this.group); // new group
			this.group.id = nid;

			this.consensus.newgroup(this.group)

			this.group.retain();

			oldgroup.release();
			return false;
		}
	},
	rand: function() {
		return this.consensus.rand();
	}
};

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function Network() {
	this.events = new Events(); // normal events
	this.pevents = {}; // probablistic event buckets
	if (typeof VISUALIZER != "undefined") {
		this.visualizer = VISUALIZER;
	} else {
		this.visualizer = false;
	}
	this.now = 0;
	this.maxrun = 0;

	this.nextcheck = 0;
	this.checkint = 0;
	this.checkf = function() {

	};

	this.nodes = [];
	this.nindex = 0;

	this._shared = {};
}

Network.prototype = {
	Node: Node,
	// grab a shared cache object
	shared: function(name) {
		if (typeof this._shared[name] == "undefined") {
			this._shared[name] = new Consensus();
		}

		return this._shared[name];
	},

	// registers probablistic event
	pregister: function(label, p, nid, cb, ctx) {
		if (typeof this.pevents[nid + "-" + label] == "undefined") {
			this.pevents[nid + "-" + label] = new NodeProbabilisticTickEvent(p, cb, nid, ctx)
			this.exec(this.pevents[nid + "-" + label], "probs")
		}
	},

	// deregisters a probablistic event
	depregister: function(label, nid) {
		if (typeof this.pevents[nid + "-" + label] != "undefined") {
			this.pevents[nid + "-" + label].ignore = true;
			delete this.pevents[nid + "-" + label];
		}
	},

	// sets the color of the node in the visualizer
	setColor: function(id, color) {
		if (typeof this.nodes[id] != "undefined")
		if (this.visualizer) {
			this.visualizer.setColor(this.nodes[id]._vid, color);
		}
	},

	// could be used to show that network activity occurred between two nodes
	setLinkActivity: function(from, to) {
		if (typeof this.nodes[to] != "undefined")
		if (typeof this.nodes[from] != "undefined")
		if (this.visualizer) {
			this.visualizer.setLinkActivity("n" + this.nodes[from]._vid + "-n" + this.nodes[to]._vid, this.now);
			this.visualizer.setLinkActivity("n" + this.nodes[to]._vid + "-n" + this.nodes[from]._vid, this.now);
		}
	},

	// places an event in the queue
	exec: function(e, bucket) {
		this.events.add(e.delay+this.now, e, bucket)
	},

	// connects two nodes in the visualizer
	connect: function (a, b) {
		if (this.visualizer) {
			this.visualizer.connect(this.nodes[a]._vid, this.nodes[b]._vid);
		}
	},

	// disconnects two nodes in the visualizer
	disconnect: function (a, b) {
		if (this.visualizer) {
			this.visualizer.disconnect(this.nodes[a]._vid, this.nodes[b]._vid);
		}
	},

	// adds amt nodes using the node constructor parameter
	add: function(amt, node) {
		for (;amt>0;amt--) {
			var state = new NodeState(node, this, this.nindex);
			if (this.visualizer)
				state._vid = this.visualizer.addNode();

			this.nodes[this.nindex] = state;
			this.nindex++;
		}
	},

	// run buffer time (msec) worth of tasks
	run: function(msec, next) {
		this.maxrun = this.now + msec;

		if (DELAY_RUN) {
			// this is an async call
			DELAY_RUN.net = this;
			DELAY_RUN.cb = next;
		} else {
			this._run(msec)
			if (next)
				next.call(this);
		}
	},

	_run: function(msec) {
		if (this.now >= this.maxrun) {
			if (DELAY_RUN) {
				if (DELAY_RUN.cb) {
					var cb = DELAY_RUN.cb;
					DELAY_RUN.cb = false;
					cb.call(this);
				}
			}
			return;
		}

		var max = this.now + msec;

		// actually run msec worth of shit
		while (e = this.events.next(max)) {
			this.now = e.time;

			if (this.checkint && (e.time > this.nextcheck)) {
				this.nextcheck = e.time + this.checkint;
				this.checkf.call(this);
			}

			this.now = e.time;
			e.event.run(this)

			if (this.now >= this.maxrun) {
				return;
			}
		}

		this.now = max;
	},

	// todo: allow for multiple check handlers, maybe turn checks into ticks
	check: function(msec, f) {
		this.nextcheck = this.now + msec;
		this.checkint = msec;
		this.checkf = f;
	},

	stop: function() {
		this.maxrun = this.now;
	}
}

module.exports = new Network();