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
			this.handlers[name](from, obj)
		}
	},

	on: function(name, f, ctx) {
		if (typeof ctx == "undefined")
			ctx = this;

		if (typeof this.handlers[name] != "undefined") {
			var oldHandler = this.handlers[name];
			this.handlers[name] = function(from, obj) {oldHandler.call(ctx, from, obj); f.call(ctx, from, obj);}
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

	this.nodes = [];
	this.nindex = 0;

	this._shared = {};
}

Network.prototype = {
	Node: Node,
	// grab a shared cache object
	shared: function(name) {
		if (typeof this._shared[name] == "undefined") {
			this._shared[name] = new ConsensusState(false, false);
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
				next();
		}
	},

	_run: function(msec) {
		if (this.now >= this.maxrun) {
			if (DELAY_RUN) {
				if (DELAY_RUN.cb) {
					DELAY_RUN.cb();
				}
			}
			return;
		}

		var max = this.now + msec;

		// actually run msec worth of shit
		while (e = this.events.next(max)) {
			this.now = e.time;
			e.event.run(this)
		}

		this.now += msec;
	}
}

module.exports = new Network();