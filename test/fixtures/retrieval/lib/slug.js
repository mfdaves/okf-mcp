"use strict";

// GitHub-style heading slug: lower-case, every character that is not a letter, a number, a
// space or a hyphen removed, spaces turned into hyphens. Hyphens are not collapsed and accents
// are kept, which is what GitHub does. Query labels keep the heading text next to the slug so
// that this rule can change (WP3a may pick another anchor rule) without relabelling.
function headingSlug(heading) {
  return String(heading || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

// Headings of a Markdown body: ATX headings outside fenced code blocks, as [level, text].
function markdownHeadings(markdown) {
  const headings = [];
  let fenced = false;
  String(markdown || "").split(/\r?\n/).forEach((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    const match = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      headings.push([match[1].length, match[2]]);
    }
  });
  return headings;
}

module.exports = {
  headingSlug,
  markdownHeadings,
};
