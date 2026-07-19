#!/usr/bin/env node
"use strict";

const { exitCodeForError, main } = require("../src/cli");

const debug = process.argv.includes("--debug");
const args = process.argv.slice(2).filter((arg) => arg !== "--debug");

main(args).catch((error) => {
  const message = debug && error && error.stack ? error.stack : (error && error.message ? error.message : String(error));
  process.stderr.write(message + "\n");
  process.exitCode = exitCodeForError(error);
});
