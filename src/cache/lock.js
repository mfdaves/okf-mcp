"use strict";

// Advisory write lock of a cache directory: one writer at a time.
//
// `lock` is created with O_EXCL and holds { token, pid, createdAt, generation }
// where token = pid plus random bytes, unique per write. A live lock is
// polled asynchronously until waitMs has passed, then the writer fails with
// cache_locked. A lock older than staleMs belongs to a writer that crashed:
// it is reclaimed by renaming it to lock.stale.<token>, which only one
// reclaimer can win. The parked file is then read back: only when it still
// carries the token that was observed stale, and is still stale, is it
// removed; a fresh lock that slipped into the slot between the staleness
// read and the rename is put back with link(parked, lock) and the slot is
// treated as busy. Release reads the lock and unlinks it only while it still
// holds the releaser's token, so a successor's lock survives a late release.
//
// Residual windows, documented rather than closed: a crashed writer blocks
// other writers for up to staleMs; a write that outlasts staleMs can lose
// its lock to a reclaimer; and when a third writer creates `lock` between a
// mistaken park and the restoring link, the displaced fresh owner finishes
// its write without the lock while its parked copy waits for collection.
// The deadline always ends in cache_locked, a failed or undone reclaim
// included.

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

// Puts a mistakenly parked fresh lock back. link() refuses when the slot has
// been taken meanwhile (EEXIST); then the parked copy stays for collection
// and its owner's release finds no token of its own and leaves things alone.
function restoreParkedLock(lockPath, parked, io) {
  try {
    io.link(parked, lockPath);
  } catch (error) {
    if (error?.code === "EEXIST") return;
    try {
      if (!fs.existsSync(lockPath)) io.rename(parked, lockPath);
    } catch {
      // Left parked; collected by age.
    }
    return;
  }
  try {
    io.remove(parked);
  } catch {
    // Left parked; collected by age.
  }
}

// Parks the lock under a name only this reclaimer uses (the rename is the
// arbitration), then checks that what was parked is the stale lock that was
// observed. Returns true only when a stale lock was removed.
function reclaimStaleLock(lockPath, observed, token, staleMs, io) {
  const parked = `${lockPath}.stale.${token}`;
  try {
    io.rename(lockPath, parked);
  } catch {
    return false;
  }
  const moved = readLock(parked);
  if (moved && moved.token === observed.token && moved.ageMs > staleMs) {
    try {
      io.remove(parked);
    } catch {
      // Left behind for garbage collection.
    }
    return true;
  }
  restoreParkedLock(lockPath, parked, io);
  return false;
}

// io: { verify(), rename(from, to), remove(target), link(from, to) }. The
// store's io verifies the directory inside every operation; verify() also
// runs before every attempt, so a directory swapped while waiting fails the
// wait instead of placing the lock, and later the files, somewhere else.
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
    if (holder && holder.ageMs > staleMs) reclaimStaleLock(lockPath, holder, token, staleMs, io);
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

// Unlinks the lock only while it still carries this writer's token.
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
