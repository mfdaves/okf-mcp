"use strict";

// Compatibility shim: live authoring moved to src/authoring/ in 0.10. Deep
// requires of this path keep working; new code should require
// "./authoring/live".
module.exports = require("./authoring/live");
