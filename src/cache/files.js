"use strict";

// File primitives for the vector cache (S-1). Every file is opened through a
// descriptor that never follows a symbolic link and is checked with fstat, so
// a link swapped in between two steps fails closed. Node has no openat, so
// the directory is re-verified by the caller before each group of operations;
// that narrows the window on every platform and cannot close it entirely.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Both are absent on Windows, where lstat before open remains the only guard
// and directory fsync is unsupported.
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const O_DIRECTORY = fs.constants.O_DIRECTORY || 0;

function writeAll(fd, content) {
  let offset = 0;
  while (offset < content.length) {
    offset += fs.writeSync(fd, content, offset, content.length - offset);
  }
}

// Errors that mean "this platform or filesystem does not sync directories";
// anything else (EIO, ENOSPC, ...) is a real failure and propagates.
const UNSUPPORTED_DIRECTORY_SYNC = new Set([
  "EINVAL",
  "ENOTSUP",
  "EOPNOTSUPP",
  "EPERM",
  "EISDIR",
  "EBADF",
]);

// Makes a rename durable: the directory entry is flushed where the platform
// allows it. options.fsync exists for tests.
function syncDirectory(dir, options) {
  if (!O_DIRECTORY) return;
  const fsyncImpl = options?.fsync || fs.fsyncSync;
  let fd = null;
  try {
    fd = fs.openSync(dir, fs.constants.O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    fsyncImpl(fd);
  } catch (error) {
    if (!UNSUPPORTED_DIRECTORY_SYNC.has(error?.code)) throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// Creates a file without following links, writes and syncs it, then renames
// it over the target (rename replaces a link without following it) and syncs
// the directory entry.
function writeAtomic(target, content) {
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
      0o600,
    );
    writeAll(fd, content);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temporary, target);
    syncDirectory(path.dirname(target));
  } finally {
    if (fd !== null) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

// Creates a file that must not exist yet, through a descriptor that never
// follows a link. Returns false when it already exists.
function createExclusive(target, content) {
  let fd = null;
  try {
    fd = fs.openSync(
      target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW,
      0o600,
    );
    writeAll(fd, content);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

// Returns the bytes of a regular file, or null when it is missing or is
// anything other than a regular file.
function readRegularFile(target) {
  let fd;
  try {
    if (fs.lstatSync(target).isSymbolicLink()) return null;
    fd = fs.openSync(target, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fs.fstatSync(fd).isFile()) return null;
    return fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function mtimeBefore(target, cutoff) {
  try {
    return fs.lstatSync(target).mtimeMs < cutoff;
  } catch {
    return false;
  }
}

module.exports = {
  createExclusive,
  mtimeBefore,
  readRegularFile,
  syncDirectory,
  writeAll,
  writeAtomic,
};
