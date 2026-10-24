"use strict";

// Compatibility shim: the server moved to src/mcp/ in 0.10. Deep requires of
// this path keep working; new code should require "./mcp/server".
module.exports = require("./mcp/server");
