const { nanoid } = require('nanoid')
module.exports = function newId(len=10){ return nanoid(len) }
