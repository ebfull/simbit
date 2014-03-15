simbit (alpha)
======

Javascript P2P Network Simulator
--------------------------------

simbit is a javascript simulation framework with an emphasis on consensus networks like Bitcoin. It is easy to rapidly prototype
new structures, protocols and concepts, and to understand their effects on latency-sensitive systems. **It is designed for 
both in-browser realtime simulation/visualization and clustered simulations using Node.**

![Example visualization](http://i.imgur.com/6ewJNUU.gif)

Running
-------

simbit can be invoked with `node sim.js` or by visiting the `index.html` page supplied in this repository.

Developing with Simbit
----------------------

A boring simulation with 100 nodes looks something like this:

```javascript
var net = require("./network")
var client = new net.Node() // create a new node template

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
var client = new net.Node()

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
var client = new net.Node()
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

In addition to `peermgr`, several other modules are being developed for simulating bitcoin specifically. These include:

1. `btc-inventory` for inventory objects and optimal propagation.
2. `btc-transactions` for transactions, a UTXO structure, mapOrphans(ByPrev)
3. `btc-blockchain` for a blockchain simulation, including difficulty adjustment, reorgs
4. `btc-miner` for mining simulation

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

var client = new net.Node()
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

### Visualizer

(todo)

API
---

#### Network

`var net = require("./network")`

| Property | Description |
| -------- | ----------- |
| `.Node`    | A `Node` class used by `.add()` |
| `.add (n, node)` | Creates `n` nodes, using `node` as a template. `node` is an instance of .Node |
| `.check (t, f)` | `f()` is called every `t` msec of simulation |
| `.run (msec)` | Run `msec` worth of simulation time. |
| `.stop()` | Stops the simulation, existing `.run` tasks will halt. |

#### Node

`var client = new net.Node()`

| Property | Description |
| -------- | ----------- |
| `.init(f)` | `f()` is called during the node's initialization. |
| `.use(middleware)` | `middleware` is constructed with the `NodeState` as an argument. |

#### NodeState

Functions like `.on()` or `.tick()` send the NodeState as function context to the handler. This can be overwritten by the (optional) `thisArg` argument.

| Property | Description |
| -------- | ----------- |
| `.on(name, f [, thisArg])` | Attaches a handler for event `name`. |
| `.tick(t, f [, thisArg])` | Attaches a handler `f` for a tick event that occurs every `t` msec. If `f` returns false, the handler is unattached. |
| `.delay(t, f [, thisArg])` | `f` is called once, in `t` msec. |
| `.prob(name, p, f [, thisArg])` | Attaches a handler `f` for a probabilistic tick event named `name`, which has a `p` chance of occuring every msec. |
| `.deprob(name)` | Removes a probabilistic handler named `name`. |
| `.now()` | Returns the current time, in msec, from the start of the simulation |
| `.setColor(str)` | Sets the color of the current node to `str` |
| `.log(str)` | Logs `str` for the node. |
