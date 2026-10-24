/*
 * Copyright (c) AXA Group Operations Spain S.A.
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// Provenance: derived from @nlpjs/core 4.26.1, src/base-stemmer.js (MIT,
// header above). The Snowball runtime (cursor, groupings, among tables,
// slicing) is kept verbatim in behaviour; removed: the dependency-injection
// container, tokenizer and stop-word lookups, the before/after dictionaries,
// and `stemWords`/`stem`/`tokenizeAndStem`. The per-word cache is bounded
// (plan WP1); upstream grows it without limit. `test/stem-parity.test.js`
// asserts zero disagreements with the pinned upstream packages.
"use strict";

// Distinct words cached per stemmer; beyond this the oldest entries are
// evicted first. A 20k-concept bilingual catalog stays well under it.
const STEM_CACHE_LIMIT = 50000;

class BaseStemmer {
  constructor() {
    this.cache = new Map();
    this.setCurrent("");
  }

  setCurrent(value) {
    this.current = value;
    this.cursor = 0;
    this.limit = this.current.length;
    this.limit_backward = 0;
    this.bra = this.cursor;
    this.ket = this.limit;
  }

  getCurrent() {
    return this.current;
  }

  // True when character offset `ch` is outside the bit-set grouping `s`.
  bc(s, ch) {
    return (s[ch >>> 3] & (0x1 << (ch & 0x7))) === 0;
  }

  in_grouping(s, min, max) {
    if (this.cursor >= this.limit) return false;
    let ch = this.current.charCodeAt(this.cursor);
    if (ch > max || ch < min) return false;
    ch -= min;
    if (this.bc(s, ch)) return false;
    this.cursor++;
    return true;
  }

  in_grouping_b(s, min, max) {
    if (this.cursor <= this.limit_backward) return false;
    let ch = this.current.charCodeAt(this.cursor - 1);
    if (ch > max || ch < min) return false;
    ch -= min;
    if (this.bc(s, ch)) return false;
    this.cursor--;
    return true;
  }

  out_grouping(s, min, max) {
    if (this.cursor >= this.limit) return false;
    let ch = this.current.charCodeAt(this.cursor);
    if (ch > max || ch < min) {
      this.cursor++;
      return true;
    }
    ch -= min;
    if (this.bc(s, ch)) {
      this.cursor++;
      return true;
    }
    return false;
  }

  out_grouping_b(s, min, max) {
    if (this.cursor <= this.limit_backward) return false;
    let ch = this.current.charCodeAt(this.cursor - 1);
    if (ch > max || ch < min) {
      this.cursor--;
      return true;
    }
    ch -= min;
    if (this.bc(s, ch)) {
      this.cursor--;
      return true;
    }
    return false;
  }

  // Upstream accepts (size, string) or (string); the generated stemmers only
  // pass the string.
  eq_s(sizeOrString, maybeString) {
    const s = typeof sizeOrString === "string" ? sizeOrString : maybeString;
    const size = typeof sizeOrString === "string" ? s.length : sizeOrString;
    if (
      this.limit - this.cursor < size ||
      this.current.slice(this.cursor, this.cursor + size) !== s
    ) {
      return false;
    }
    this.cursor += size;
    return true;
  }

  eq_s_b(sizeOrString, maybeString) {
    const s = typeof sizeOrString === "string" ? sizeOrString : maybeString;
    const size = typeof sizeOrString === "string" ? s.length : sizeOrString;
    if (
      this.cursor - this.limit_backward < size ||
      this.current.slice(this.cursor - size, this.cursor) !== s
    ) {
      return false;
    }
    this.cursor -= size;
    return true;
  }

  find_among(v, v_size) {
    let i = 0;
    let j = v_size || v.length;
    const c = this.cursor;
    const l = this.limit;
    let common_i = 0;
    let common_j = 0;
    let first_key_inspected = false;

    while (true) {
      const k = i + ((j - i) >>> 1);
      let diff = 0;
      let common = common_i < common_j ? common_i : common_j;
      const w = v[k];
      for (let i2 = common; i2 < w.s_size; i2++) {
        if (c + common === l) {
          diff = -1;
          break;
        }
        diff = this.current.charCodeAt(c + common) - w.s.charCodeAt(i2);
        if (diff !== 0) break;
        common++;
      }
      if (diff < 0) {
        j = k;
        common_j = common;
      } else {
        i = k;
        common_i = common;
      }
      if (j - i <= 1) {
        if (i > 0) break;
        if (j === i) break;
        // One more round so that v[0] is inspected as well.
        if (first_key_inspected) break;
        first_key_inspected = true;
      }
    }
    while (true) {
      const w = v[i];
      if (common_i >= w.s_size) {
        this.cursor = c + w.s_size;
        if (w.method === undefined || w.method === null) {
          return w.result;
        }
        const res = w.method(w.instance);
        this.cursor = c + w.s_size;
        if (res) {
          return w.result;
        }
      }
      i = w.substring_i;
      if (i < 0) return 0;
    }
  }

  // Backwards variant of find_among; the same comments apply.
  find_among_b(v, v_size) {
    let i = 0;
    let j = v_size || v.length;
    const c = this.cursor;
    const lb = this.limit_backward;
    let common_i = 0;
    let common_j = 0;
    let first_key_inspected = false;

    while (true) {
      const k = i + ((j - i) >> 1);
      let diff = 0;
      let common = common_i < common_j ? common_i : common_j;
      const w = v[k];
      for (let i2 = w.s_size - 1 - common; i2 >= 0; i2--) {
        if (c - common === lb) {
          diff = -1;
          break;
        }
        diff = this.current.charCodeAt(c - 1 - common) - w.s.charCodeAt(i2);
        if (diff !== 0) break;
        common++;
      }
      if (diff < 0) {
        j = k;
        common_j = common;
      } else {
        i = k;
        common_i = common;
      }
      if (j - i <= 1) {
        if (i > 0) break;
        if (j === i) break;
        if (first_key_inspected) break;
        first_key_inspected = true;
      }
    }
    while (true) {
      const w = v[i];
      if (common_i >= w.s_size) {
        this.cursor = c - w.s_size;
        if (w.method === undefined || w.method === null) return w.result;
        const res = w.method(this);
        this.cursor = c - w.s_size;
        if (res) return w.result;
      }
      i = w.substring_i;
      if (i < 0) return 0;
    }
  }

  // Replace the characters between c_bra and c_ket with s.
  replace_s(c_bra, c_ket, s) {
    const adjustment = s.length - (c_ket - c_bra);
    this.current = this.current.slice(0, c_bra) + s + this.current.slice(c_ket);
    this.limit += adjustment;
    if (this.cursor >= c_ket) this.cursor += adjustment;
    else if (this.cursor > c_bra) this.cursor = c_bra;
    return adjustment;
  }

  slice_check() {
    return !(
      this.bra < 0 ||
      this.bra > this.ket ||
      this.ket > this.limit ||
      this.limit > this.current.length
    );
  }

  slice_from(s) {
    if (this.slice_check()) {
      this.replace_s(this.bra, this.ket, s);
      return true;
    }
    return false;
  }

  slice_del() {
    return this.slice_from("");
  }

  insert(c_bra, c_ket, s) {
    const adjustment = this.replace_s(c_bra, c_ket, s);
    if (c_bra <= this.bra) this.bra += adjustment;
    if (c_bra <= this.ket) this.ket += adjustment;
  }

  slice_to() {
    return this.slice_check() ? this.current.slice(this.bra, this.ket) : "";
  }

  // Subclasses implement the Snowball algorithm over `this.current`.
  innerStem() {
    return false;
  }

  stemWord(word) {
    const cached = this.cache.get(word);
    if (cached !== undefined) {
      return cached;
    }
    this.setCurrent(word);
    this.innerStem();
    const result = this.getCurrent();
    if (this.cache.size >= STEM_CACHE_LIMIT) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(word, result);
    return result;
  }
}

BaseStemmer.STEM_CACHE_LIMIT = STEM_CACHE_LIMIT;

module.exports = BaseStemmer;
