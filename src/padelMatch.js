const { randomUUID } = require('crypto'); 

const padelMatch =  function (owner) {
	this.id = randomUUID().slice(-8);
	this.dateTime = null;
	this.place = '';
	this.players = [];
	this.payed = false;
	this.owner = owner;
}

module.exports = padelMatch;