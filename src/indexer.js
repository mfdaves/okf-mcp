"use strict";

// Compatibility shim: the indexer moved to src/indexer/ in 0.10. Deep
// requires of this path keep working; new code should require "./indexer".
module.exports = require("./indexer/index");
