/*
The PeerMgr is the inter-client behavior middleware for establishing connections
with other peers, thus forming a network.

(This peer manager is not intended to accurately mimic bitcoin yet.)

Current behavior: every 1 second it checks to see if it has 'maxpeers'. If not, it attempts
either to connect to an archived addr, or get addresses from other nodes it has contacted.
Initially, the only archived addr is the bootstrap node, 0. Once the node has received
maxpeers, it stops ticking.
*/

function PeerState(id, lastmessage) {
	this.id = id;
	this.lastmessage = lastmessage;
	this.active = false;
	this.locked = true;
	this.msgqueue = [];
}

function PeerMgr(self) {
	// attach to nodestate 'peers' property
	// self.peers = this;
	self.peermgr = this;

	this.ticking = false;
	this.peers = {}; // current established or attempted connections
	this.numpeers = 0; // the number of peers we have
	this.maxpeers = 8; // the max number of peers we can have
	if (self.id != 0)
		this.nodearchive = [new PeerState(0, self.now())]; // a node archived, initialized with a bootstrap node
	else
		this.nodearchive = []

	var peerTick = function() {
		if (this.numpeers < this.maxpeers) {
			// we need more peers

			// let's try connecting to a peer in our nodearchive, if there are any
			if (this.nodearchive.length) {
				var p = this.nodearchive.shift();
				this.nodearchive.push(p);

				// try connecting to this node, fails if we're already trying/connected
				this.connect(p);
			}

			// if we have (active) connections, ask them for new peers
			if (this.numpeers) {
				var randomPeer = this.peers[Object.keys(this.peers)[Math.floor(Math.random() * Object.keys(this.peers).length)]]

				if (randomPeer.active) {
					this.getpeers(randomPeer.id)
				}
			}

			if (self.now() > 1000 * 1000) // after 1000 seconds, let's tick every 5 seconds instead
				return 5000;
		} else {
			_ticking = false;
			self.peermgr.ticking = false;
			return false; // no more ticking necessary
		}
	}

	var _ticking = false;
	var startTicking = function() {
		if (!_ticking) {
			_ticking = true;
			self.peermgr.ticking = true;

			self.tick(1000, peerTick, self.peermgr);
		}
	}

	this.numActive = function() {
		var n = 0;
		for (var p in this.peers) {
			if (this.peers[p].active) {
				n++;
			}
		}
		return n;
	}

	this.send = function(to, name, msg) {
		if (this.peers[to].active) {
			if (this.peers[to].locked) {
				this.peers[to].msgqueue.push({name:name,obj:msg})
			} else {
				self.send(this.peers[to].id, "__peermsg", {name:name,obj:msg})
			}
		}
	}

	this.each = function(cb) {
		for (var p in this.peers) {
			if (this.peers[p].active)
				cb.call(self, p)
		}
	}

	// sends a message to all active peers
	this.broadcast = function(name, msg) {
		for (var p in this.peers) {
			this.send(p, name, msg)
		}
	}

	// request peers from a remote node
	this.getpeers = function(p) {
		self.send(p, 'getpeers', {});
	}

	// send a portion of our archived node list
	this.sendpeers = function(p) {
		var someNodes = this.nodearchive.slice(0, 15)
		if (someNodes.length == 0) {
			var randomPeer = this.peers[Object.keys(this.peers)[Math.floor(Math.random() * Object.keys(this.peers).length)]]
			if (randomPeer.active)
				someNodes = [randomPeer]
		}

		self.send(p, 'peerlist', someNodes);
	}

	// connect to a remote node (if we haven't already tried)
	this.connect = function(p) {
		if (self.id == p.id)
			return; // can't connect to ourselves!

		if (typeof this.peers[p.id] == "undefined") {
			this.peers[p.id] = p;
			this.numpeers += 1;
			self.send(p.id, 'connect', {})
		}
	}

	// disconnect from a remote node
	this.disconnect = function(p) {
		if (typeof this.peers[p] != "undefined") {
			var peer = this.peers[p];
			delete this.peers[p];

			//if (peer.active) {
				self.send(p, 'disconnect', {})
				self.disconnect(p);
				startTicking();
			//}

			this.nodearchive.push(peer);
			this.numpeers -= 1;
			self.handle(p, "peermgr:disconnect", p)
		}
	}

	// accept a remote node's connection
	this.accept = function(p) {
		p.locked = true; // wait for an ack
		self.send(p.id, 'accept', {})
	}

	// reject a remote node's connection
	this.reject = function(p) {
		var someNodes = this.nodearchive.slice(0, 15)
		if (someNodes.length == 0) {
			var randomPeer = this.peers[Object.keys(this.peers)[Math.floor(Math.random() * Object.keys(this.peers).length)]]
			if (randomPeer.active)
				someNodes = [this.randomPeer]
		}

		self.send(p.id, 'reject', someNodes)
	}

	this.onAck = function(from, o) {
		if (typeof this.peers[from] != "undefined") {
			this.peers[from].locked = false;
			this.peers[from].lastmessage = self.now()

			if (this.peers[from].msgqueue.length > 0) {
				var domsg = this.peers[from].msgqueue.shift();
				this.peers[from].locked = true;
				self.send(this.peers[from].id, "__peermsg", {name:domsg.name,obj:domsg.obj})
			}
		}
	}

	// processes a received message from another peer
	this.onReceive = function(from, o) {
		if (typeof this.peers[from] != "undefined" && this.peers[from].active) {
			self.send(from, 'ack', {})
			self.handle(from, o.name, o.obj)
			this.peers[from].lastmessage = self.now();
		}
	}

	// receive a peerlist message
	this.onPeerlist = function(from, obj) {
		// are we connected to this peer?
		if (this.peers[from] != "undefined") {
			// add these peers to our nodearchive
			// if we don't have them already

			for (var i=0;i<obj.length;i++) {
				var candidate = obj[i];

				// remove redundant existing nodearchive objects
				for (var k=0;k<this.nodearchive.length;k++) {
					if (this.nodearchive[k].id == candidate.id) {
						this.nodearchive.splice(k, 1);
					}
				}

				this.nodearchive.push(new PeerState(candidate.id, self.now()))
			}
		}
	}

	// receive a getpeers message
	this.onGetpeers = function(from, obj) {
		// are we connected to this peer?
		if (this.peers[from] != "undefined") {
			this.sendpeers(from)
		}
	}

	// receive a reject message
	this.onReject = function(from, obj) {
		if (typeof this.peers[from] != "undefined") {
			this.onPeerlist(from, obj) // process rejection peerlist
			this.disconnect(from) // cya
		}
	}

	// receive an accept message
	this.onAccept = function(from, obj) {
		if (typeof this.peers[from] != "undefined") {
			// remove them from our nodearchive
			for (var i=0;i<this.nodearchive.length;i++) {
				if (this.nodearchive[i].id == from) {
					this.nodearchive.splice(i, 1)
				}
			}

			// set connection active
			this.peers[from].lastmessage = self.now();
			this.peers[from].active = true;

			self.send(from, 'ack', {})

			// notify Network of connection
			self.connect(from);

			self.handle(from, "peermgr:connect", from)
		}
	}

	// receive a disconnect message
	this.onDisconnect = function(from, obj) {
		this.disconnect(from)
	}

	this.onConnect = function(from, obj) {
		// are you already trying to connect?
		if (typeof this.peers[from] != "undefined")
			return; // do nothing

		if (this.numpeers < this.maxpeers) {
			// sure, we'll accept you. we need a peer.

			// are we already connected to you?
			this.peers[from] = new PeerState(from, self.now())
			this.numpeers += 1;
			this.onAccept(from, obj);
			this.accept(this.peers[from])

			return;
		}

		// otherwise, reject this node.

		// remove node from nodearchive in any redundant locations
		for (var i=0;i<this.nodearchive.length;i++) {
			if (this.nodearchive[i].id == from) {
				this.nodearchive.splice(i, 1)
			}
		}

		var rejectPeer = new PeerState(from, self.now());

		// add back to nodearchive in the front
		this.nodearchive.push(rejectPeer)

		// send node a rejection message
		this.reject(rejectPeer);
	}

	//
	// attach to the node
	//

	// tick that runs every 1 second
	startTicking();

	self.on("connect", this.onConnect, this);
	self.on("accept", this.onAccept, this);
	self.on("reject", this.onReject, this);
	self.on("disconnect", this.onDisconnect, this);
	self.on("peerlist", this.onPeerlist, this);
	self.on("getpeers", this.onGetpeers, this);
	self.on("ack", this.onAck, this);
	self.on("__peermsg", this.onReceive, this);
}

module.exports = PeerMgr;