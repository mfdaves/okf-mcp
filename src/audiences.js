"use strict";

// Audiences (plan I-2d): a bundle may name the audiences that read it, and a
// principal the audiences it belongs to. A bundle without audiences is read
// by every principal; one with audiences by the principals holding at least
// one of them, and by a principal that reads every bundle (stdio, where the
// operator has the files).

const AUDIENCE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const MAX_AUDIENCES = 64;
// What a bundle whose `audiences` could not be read gets: no principal can
// hold it, so a misconfigured bundle is closed rather than open.
const NO_AUDIENCE = "!";

// The audiences in `value` as a Set. Anything but a list of at most 64 valid
// names gives none, so a principal the server cannot place reads only the
// bundles open to everyone.
function audienceSet(value) {
  if (!Array.isArray(value) || value.length > MAX_AUDIENCES) return new Set();
  if (!value.every((name) => typeof name === "string" && AUDIENCE_NAME.test(name))) {
    return new Set();
  }
  return new Set(value);
}

// Whether `names` is what a bundle may declare: a non-empty list of distinct
// audience names.
function validBundleAudiences(names) {
  return (
    Array.isArray(names) &&
    names.length > 0 &&
    names.length <= MAX_AUDIENCES &&
    names.every((name) => typeof name === "string" && AUDIENCE_NAME.test(name)) &&
    new Set(names).size === names.length
  );
}

// Whether `principal` may read a bundle declaring `audiences`.
function mayRead(principal, audiences) {
  if (!audiences || !audiences.length) return true;
  if (principal?.allBundles) return true;
  return audiences.some((name) => principal?.audiences?.has(name));
}

// Whether every principal that reads a bundle declaring `readers` also reads
// one declaring `target`: the target is open, or the readers are restricted
// to audiences the target names too.
function readersInclude(target, readers) {
  if (!target || !target.length) return true;
  if (!readers || !readers.length) return false;
  return readers.every((name) => target.includes(name));
}

module.exports = {
  AUDIENCE_NAME,
  MAX_AUDIENCES,
  NO_AUDIENCE,
  audienceSet,
  mayRead,
  readersInclude,
  validBundleAudiences,
};
