"use strict";

// Advisory write lock of a cache directory: one writer at a time.
//
// `lock` is created with O_EXCL and holds { token, pid, createdAt, generation }
// where token = pid plus random bytes, unique per write. A live lock is
// polled asynchronously until waitMs has passed, then the writer fails with
// cache_locked. A lock older than staleMs belongs to a writer that crashed:
// it is reclaimed by renaming it to lock.stale.<token>, which only one
// reclaimer can win, and unlinking the renamed file; the reclaimer then
// competes for a fresh lock like everyone else. Release reads the lock and
// unlinks it only while it still holds the releaser's token, so a successor's
// lock survives a late release. A crashed writer therefore blocks other
// writers for up to staleMs; the deadline always ends in cache_locked, a
// failed reclaim included.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createExclusive, readRegularFile } = require("./files");
const { VectorCacheError } = require("./paths");

const LOCK_FILE = "lock";
const LOCK_POLL_MS = 25;
const GENERATION_PATTERN = /^[0-9a-z]{1,16}-[0-9a-f]{8}$/;

function newLockToken() {
  return `${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
}

function sleep(ms) {
  // Referenced on purpose: a process waiting for the lock must stay alive.
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Reads a lock file; returns { token, pid, generation, ageMs } or null when
// absent. An unreadable or unparsable lock is aged by its mtime.
function readLock(lockPath) {
  let stat;
  try {
    stat = fs.lstatSync(lockPath);
  } catch {
    return null;
  }
  let parsed = null;
  const bytes = stat.isFile() ? readRegularFile(lockPath) : null;
  if (bytes) {
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      parsed = null;
    }
  }
  const createdAt =
    parsed && typeof parsed.createdAt === "string" ? Date.parse(parsed.createdAt) : Number.NaN;
  const since = Number.isFinite(createdAt) ? createdAt : stat.mtimeMs;
  return {
    token: parsed && typeof parsed.token === "string" ? parsed.token : null,
    pid: parsed && Number.isSafeInteger(parsed.pid) ? parsed.pid : null,
    generation:
      parsed && typeof parsed.generation === "string" && GENERATION_PATTERN.test(parsed.generation)
        ? parsed.generation
        : null,
    ageMs: Math.max(0, Date.now() - since),
  };
}

// Parks a stale lock under a name only this reclaimer uses; the rename is
// the arbitration, the unlink is best effort (garbage collection finishes it).
function reclaimStaleLock(lockPath, token, io) {
  const parked = `${lockPath}.stale.${token}`;
  try {
    io.rename(lockPath, parked);
  } catch {
    return false;
  }
  try {
    io.remove(parked);
  } catch {
    // Left behind for garbage collection.
  }
  return true;
}

// io: { verify(), rename(from, to), remove(target) }. verify() runs before
// every attempt so a directory swapped while waiting fails the wait instead
// of placing the lock, and later the files, somewhere else.
async function acquireLock(dir, options) {
  const { token, generation, waitMs, staleMs, io } = options;
  const lockPath = path.join(dir, LOCK_FILE);
  const deadline = Date.now() + waitMs;
  for (;;) {
    io.verify();
    let created;
    try {
      const claim = { token, pid: process.pid, createdAt: new Date().toISOString(), generation };
      created = createExclusive(lockPath, Buffer.from(JSON.stringify(claim)));
    } catch (error) {
      throw new VectorCacheError(
        "The vector cache could not be locked for writing.",
        "cache_write_failed",
        { cause: typeof error?.code === "string" ? error.code : "unknown" },
      );
    }
    if (created) return lockPath;
    const holder = readLock(lockPath);
    if (holder && holder.ageMs > staleMs) reclaimStaleLock(lockPath, token, io);
    if (Date.now() >= deadline) {
      throw new VectorCacheError(
        "The vector cache is being written by another process.",
        "cache_locked",
        { pid: holder ? holder.pid : null, ageMs: holder ? holder.ageMs : null },
      );
    }
    await sleep(LOCK_POLL_MS);
  }
}

// Unlinks the lock only while it still carries this writer's token. The read
// and the unlink are two steps; a successor can slip in between only after a
// write that outlasted staleMs, which is the documented residual window.
function releaseLock(lockPath, token, io) {
  const holder = readLock(lockPath);
  if (!holder || holder.token !== token) return false;
  try {
    io.remove(lockPath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  GENERATION_PATTERN,
  LOCK_FILE,
  LOCK_POLL_MS,
  acquireLock,
  newLockToken,
  readLock,
  releaseLock,
};
