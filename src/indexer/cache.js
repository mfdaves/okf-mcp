"use strict";

const { refreshIndex, updateIndex } = require("./update");

// Whether two lists name the same additional bundle snapshots: the same
// objects in the same order. A replacement snapshot under an existing id is
// another object, so it invalidates an index built over the old one.
function sameBundles(left, right) {
  const before = left || [];
  const after = right || [];
  return (
    before.length === after.length && before.every((bundle, position) => bundle === after[position])
  );
}

// One index a host keeps between the batches it writes: brought up to date
// from the files before each use, moved along with each operation's result,
// and tied to the additional bundle snapshots it was built over. `now` is the
// clock date-dependent signals are judged against (see updateIndex).
class IndexCache {
  constructor(options) {
    const config = options || {};
    this.now = config.now || (() => new Date());
    this.entry = null;
  }

  // Options for updateIndex and refreshIndex on this cache's index.
  options() {
    return { asOf: this.now() };
  }

  get index() {
    return this.entry ? this.entry.index : null;
  }

  // Whether the cached index came from the host (adopt) rather than a build
  // of the cache's own.
  get hostOwned() {
    return Boolean(this.entry?.hostOwned);
  }

  adopt(index, bundles) {
    this.entry = { bundles: (bundles || []).slice(), index, hostOwned: true };
  }

  // The index for these bundles, refreshed from the files, or the result of
  // `build` when no cached index fits.
  current(bundles, build) {
    const entry = this.entry;
    if (entry && sameBundles(entry.bundles, bundles)) {
      const refreshed = refreshIndex(entry.index, this.options());
      this.replace(entry.index, refreshed);
      return refreshed;
    }
    const index = build();
    this.entry = { bundles: (bundles || []).slice(), index, hostOwned: false };
    return index;
  }

  // Applies changes to an index and, when it is the cached one, keeps the
  // cache on the result.
  update(index, changes) {
    const next = updateIndex(index, changes, this.options());
    this.replace(index, next);
    return next;
  }

  replace(index, next) {
    if (this.entry && this.entry.index === index && next !== index) {
      this.entry = Object.assign({}, this.entry, { index: next });
    }
  }

  // For when the files are no longer known to match any index the cache
  // holds (an incomplete rollback, a diverged worktree).
  forget() {
    this.entry = null;
  }
}

module.exports = { IndexCache, sameBundles };
