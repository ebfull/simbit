var net = require("./network"),
    peermgr = require("./peermgr"),
	client = new net.Node()

client.use(peermgr)

client.init(function() {
	this.results = []
	this.period = 0

	this.delta = Math.floor(Math.random() * 10000)
	if (Math.random() < 0.5)
		this.delta *= -1;

	this.getTime = function() {
		return this.now() + this.delta;
	}

	this.setTime = function(delta) {
		this.delta += delta;
	}

	// every second, broadcast our local time to our peers
	this.tick(1000, function() {
		this.peermgr.broadcast("ping", {start:this.getTime(),period:this.period})
	})

	// every ten seconds, use the roundtrip samples we took and update our time
	this.tick(10000, function() {
		if (this.results.length > 0) {
			var avg = 0;
			this.results.forEach(function(delta) {
				avg += delta;
			})

			avg /= this.results.length;
			avg = Math.floor(avg);

			this.setTime(avg);
		}

		this.results = []
		this.period++
	})

	// respond with pongs so our peers can calculate roundtrips
	this.on("ping", function(from, o) {
		this.peermgr.send(from, "pong", {period:o.period,start:o.start,end:this.getTime()});
	})

	// calculate delay
	this.on("pong", function(from, roundtrip) {
		if (roundtrip.period != this.period)
			return // ignore this pong

		var delay = (this.getTime() - roundtrip.start) / 2
		var newTime = roundtrip.end + delay;
		var newDelta = newTime - this.getTime()

		this.results.push(newDelta)
	})
})


var stddev = function(a) {
	var mean = 0;
	a.forEach(function(num) { mean+=num; })
	mean /= a.length;

	var variance = 0;
	a.forEach(function(num) { variance += Math.pow(num - mean, 2); })
	variance /= a.length;

	return Math.sqrt(variance);
}

net.add(100, client)
net.check(15000, function() {
	var times = [];

	this.nodes.forEach(function(node) {
		times.push(node.getTime())
	})

	var x = stddev(times)

	this.visualizer.log("stddev: " + x)

	if (x < 2)
		this.stop();
})
net.run(Infinity)