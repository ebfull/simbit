var Inventory = require("./btc/inventory.js")
var Mempool = require("./btc/mempool.js")
var Transactions = require("./btc/transactions.js")
var Blockchain = require("./btc/blockchain.js")
var Miner = require("./btc/miner.js")

var btc = function(self) {
	new Inventory(self);
	new Mempool(self);
	new Transactions(self);
	new Blockchain(self);
	new Miner(self);
};


btc.Blockchain = Blockchain.prototype;

module.exports = btc;