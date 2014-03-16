var Inventory = require("./btc/inventory.js")
var Transactions = require("./btc/transactions.js")
var Blockchain = require("./btc/blockchain.js")
var Miner = require("./btc/miner.js")

module.exports = function(self) {
	new Inventory(self);
	new Transactions(self);
	new Blockchain(self);
	new Miner(self);
}