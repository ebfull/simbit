simbit (alpha)
======

Javascript P2P Network Simulator
--------------------------------

simbit is a javascript simulation framework with an emphasis on consensus networks like Bitcoin. It is easy to rapidly prototype
new structures, protocols and concepts, and to understand their effects on latency-sensitive systems. **It is designed for 
both in-browser realtime simulation/visualization and clustered simulations using Node.**

![Example visualization](http://i.imgur.com/0oSfSw4.gif)

Running
-------

simbit can be invoked with `node sim.js` or by visiting the `index.html` page supplied in this repository.

Developing with Simbit
----------------------

A boring simulation with 100 nodes looks something like this:

```javascript
var net = require("./network")
var client = new net.Client() // create a new node template

net.add(100, client); // instantiate 100 nodes using the client template
net.run(100 * 1000); // runs for 100 seconds
```

You can set the contents of `sim.js` to the above code and visit `index.html` to see it in action. In this simple example, 
none of the nodes will do anything or connect to each other.

simbit uses a middleware architecture for including modules, and some modules are provided. `peermgr` provides basic networking
mechanisms, latency simulation, peer discovery, buffering and more.

```javascript
var net = require("./network"),
    peermgr = require("./peermgr") // include peermgr
var client = new net.Client()

client.use(peermgr) // use the peermgr middleware

net.add(100, client)
net.run(100 * 1000)
```

Now look at `index.html` -- you will notice the nodes discover and connect to each other. The first node (node 0) is used 
as a bootstrap node by peermgr.

Let's have the client (randomly) select the maximum number of nodes it would like to connect to, when it's initialized.

```javascript
var net = require("./network"),
    peermgr = require("./peermgr")
var client = new net.Client()
client.use(peermgr)

client.init(function() {
	// this function is called when a node is initialized
	this.peermgr.maxpeers = Math.random() * 20 + 8;
})

net.add(100, client)
net.run(100 * 1000)
```

### Tick events

Tick events are events that occur to clients at some interval of time. `peermgr` will already use ticks to space out 
connection and discovery attempts until it reaches maxpeers. We can use ticks ourselves like this:

```javascript
client.init(function() {
	this.tick(1000, function() {
		// will tick every second

		return false; // if we return false, this tick stops
	})
})
```

Probabilistic tick events have a non-zero chance of occuring at any msec; uses an exponential distribution for discrete event simulation:

```javascript
client.init(function() {
	this.prob("mining", (1/3000), function() {
		// we can expect this function to be called, on average, every 3000 msec
	})
})
```

### Communication

Here's a simple ping/pong protocol which uses `peermgr` and `.on` handlers.

```javascript
client.init(function() {
	this.tick(1000, function () {
		// every second we'll broadcast a ping message to our peers, containing a timestamp
		this.peermgr.broadcast("ping", this.now());
	})

	this.on("ping", function(from, time) {
		// we received a ping message (courtesy of peermgr)
		this.peermgr.send(from, "pong", time); // send back a pong
	})

	this.on("pong", function(from, time) {
		// we received a pong message from another peer
		this.log("roundtrip: " + (this.now() - time))
	})
})
```

Also notice that this uses `this.now()` to get the current simulation time in msec, and `this.log()` for debugging or 
statistics.

### Middleware

In addition to `peermgr`, a module `btc` is being created to simulate the Bitcoin reference client.

You can create your own middleware like so:

```javascript
module.exports = function (self) {
	self.tick(1000, function() {
		// i am a thread that loves wasting cpu!
		Math.random() + Math.random() + Math.random()
	})
}
```

Place the above into, say, waster.js, and require() it in sim.js as well:

```javascript
var net = require("./network"),
    peermgr = require("./peermgr"),
    waster = require("./waster") // include our new middleware

var client = new net.Client()
client.use(peermgr)
client.use(waster) // use the middleware

net.add(100, client)
net.run(100 * 1000)
```

### Client-side Delay

If the client needs to simulate a time-consuming computation, it can use `.delay()` to create an event which occurs once, 
in the future.

```javascript
client.init(function() {
	this.on("tx", function(from, tx) {
		// pretend it takes 25msec to verify the transaction
		this.delay(25, function() {
			// this function will be called in 25msec
		});
	})
})
```

API
---

#### Network

`var net = require("./network")`

| Property | Description |
| -------- | ----------- |
| `.Client`    | A `Client` class used by `.add()` |
| `.add (n, client)` | Creates `n` nodes, using `client` as a template. `node` is an instance of .Client |
| `.check (t, f)` | `f()` is called every `t` msec of simulation |
| `.run (msec)` | Run `msec` worth of simulation time. |
| `.stop()` | Stops the simulation, existing `.run` tasks will halt. |
| `.log(str)` | Logs `str` to console or to the visualizer |

#### Client

`var client = new net.Client()`

| Property | Description |
| -------- | ----------- |
| `.init(f)` | `f()` is called during the node's initialization. |
| `.use(middleware)` | `middleware` is constructed with the `NodeState` as an argument. |

#### NodeState

Functions like `.on()` or `.tick()` send the NodeState as function context to the handler. This can be overwritten by the (optional) `thisArg` argument.

| Property | Description |
| -------- | ----------- |
| `.on(name, f [, thisArg])` | Attaches a handler `f(from, msg)` for event `name`. If `f` returns false, the previously attached handler(s) by this `name` are bypassed. |
| `.tick(t, f [, thisArg])` | Attaches a handler `f` for a tick event that occurs every `t` msec. If `f` returns false, the handler is unattached. If it returns an integer, the tick interval is changed to that integer. |
| `.delay(t, f [, thisArg])` | `f` is called once, in `t` msec. |
| `.prob(name, p, f [, thisArg])` | Attaches a handler `f` for a probabilistic tick event named `name`, which has a `p` chance of occuring every msec. |
| `.deprob(name)` | Removes a probabilistic handler named `name`. |
| `.now()` | Returns the current time, in msec, from the start of the simulation |
| `.setColor(str)` | Sets the color of the current node to `str` |
| `.log(str)` | Logs `str` for the node. |
| `.setColor(str)` | Sets the color of the node to `str` within the visualizer |

#### peermgr

```javascript
var net = require("./network"),
    peermgr = require("./peermgr"), // include peermgr
	client = new net.Client()

client.use(peermgr) // use it
```

The peermgr middleware is stored in NodeState's `peermgr` property when it is used by the client.

| Property | Description |
| -------- | ----------- |
| `this.peermgr.maxpeers` | Integer describing the maximum number of peers peermgr should attempt to connect to; best modified at initialization |
| `this.peermgr.send(to, name, msg)` | Sends a message `msg` called `name` to peer number `to` |
| `this.peermgr.each(cb)` | Iterates over all active peers by calling `cb(peerid)` with each peer id |
| `this.peermgr.broadcast(name, msg)` | Broadcasts a message `msg` named `name` to all active peers |

To handle messages remote nodes send you, use .on() like so:

```javascript
client.init(function() {
	this.on("alert", function(from, obj) {
		// received an alert from our peer!
		// contents of message is in obj
	})
})
```

#### btc

The `btc` middleware is being developed to simulate the bitcoin reference client.

```javascript
var net = require("./network"),
    peermgr = require("./peermgr"),
    btc = require("./btc"),
	client = new net.Client()

client.use(peermgr)
client.use(btc)

client.init(function() {
	if (this.id == 0) {
		var tx1 = this.transactions.create([], 1); // creates a transaction with no inputs (like a coinbase) and one output
		var tx2 = this.transactions.create([tx1.in(0)], 1) // creates a transaction which spends the previous transaction

		// Let's enter the transactions into our local UTXO:
		this.transactions.enter(tx2) // this will appear in mapOrphans until we enter tx1
		this.transactions.enter(tx1) // both tx1 and tx2 will be part of the UTXO now

		// Now let's create inventory objects for these transactions:
		this.inventory.createObj('tx', tx1)
		this.inventory.createObj('tx', tx2)

		this.delay(30000, function() {
			// 30 seconds later, we could start relaying both transactions
			this.inventory.relay(tx1.id)
			this.inventory.relay(tx2.id)
		})
	}
})

net.add(100, client);
net.run(200 * 1000)
```

A blockchain system already functions, performing reorgs, storing orphan blocks, and directing blocks to be relayed.

A miner system is being developed:

```javascript
var net = require("./network"),
    peermgr = require("./peermgr"),
    btc = require("./btc"),
	client = new net.Client()

client.use(peermgr)
client.use(btc)

var left = 1; // mining resources left

client.init(function() {
	var myResources = Math.random() * left / 3;
	left -= myResources;

	this.mine(myResources)

	this.on("miner:success", function(from, b) {
		this.log("yay we mined a block (height=" + b.h + ")")
	})
});

net.add(200, client)
net.run(Infinity)
```