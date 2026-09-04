/**
 * A `window.cep` that behaves the way the real CEP host does.
 *
 * The point of this fake is the ONE behaviour the panel got wrong for four
 * releases: `cep.fs.readFile` decodes the file as UTF-8 unless it is handed
 * `cep.encoding.Base64`, and an unrecognised encoding argument -- `undefined`
 * included -- is not an error. It silently gets you the text decode.
 *
 * A fake that returned the file's bytes for any argument would have let the
 * bug through, which is precisely what happened: there was no fake at all, so
 * `readBlob` was never executed outside After Effects. Modelled from the CEP
 * HTML Extension Cookbook's "read a file" section.
 */
"use strict";

// Adobe's own values. Only the identity matters here, not the numbers.
const encoding = { UTF8: "UTF-8", Base64: "Base64" };

/**
 * JavaScript strings are UTF-16, and `charCodeAt` returns code units. A
 * UTF-8 decode of arbitrary bytes therefore both loses information (invalid
 * bytes collapse to U+FFFD) and changes length (valid multi-byte sequences
 * shrink; astral characters become surrogate pairs). Reproduced exactly.
 */
function utf8DecodeLikeTheHost(bytes) {
  return new TextDecoder("utf-8").decode(bytes); // lossy by design
}

function base64Encode(bytes) {
  return Buffer.from(bytes).toString("base64");
}

/**
 * @param {Object<string, Uint8Array>} files  path -> contents
 * @param {Object} [options]  `missing` lists paths that fail with an error code
 */
function makeCep(files, options) {
  const opts = options || {};
  return {
    encoding: opts.noBase64 ? { UTF8: encoding.UTF8 } : encoding,
    fs: {
      readFile(path, enc) {
        const bytes = files[path];
        if (!bytes) return { err: 2, data: null };
        if (enc === encoding.Base64) {
          return { err: 0, data: base64Encode(bytes) };
        }
        // Anything else — including undefined, which is what a constant that
        // does not exist evaluates to — is a UTF-8 text read.
        return { err: 0, data: utf8DecodeLikeTheHost(bytes) };
      },
    },
  };
}

/** The decode half of the old readBlob, for tests that assert it was broken. */
function charCodesMasked(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

module.exports = { makeCep, encoding, charCodesMasked };
