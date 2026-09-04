/**
 * Reading a binary file out of the CEP host, correctly.
 *
 * This exists because getting it wrong is silent. `cep.fs.readFile` decodes
 * the file as UTF-8 unless it is explicitly told otherwise, and Adobe
 * documents exactly one way to say otherwise: `cep.encoding.Base64` (CEP HTML
 * Extension Cookbook, "read a file"). There is no "raw" or "none" mode. Pass
 * anything the host does not recognise -- including `undefined`, which is what
 * a misremembered constant name evaluates to -- and it quietly falls back to
 * UTF-8.
 *
 * Doing that to PCM audio destroys it. Every byte >= 0x80 that is not part of
 * a valid UTF-8 sequence becomes U+FFFD, valid multi-byte sequences collapse
 * several bytes into one code point, and the WAV header is rewritten along
 * with the samples. v0.2.4 shipped exactly that: a 30-second podcast reached
 * the backend as 22 seconds of noise whose header claimed 65021 Hz, and the
 * model -- correctly -- found no speech in it.
 *
 * So the encoding is named explicitly, a missing constant is a loud error
 * rather than a fallback, and the caller passes the size it expects. Nothing
 * here is allowed to fail quietly.
 *
 * Pure apart from the injected `cep` object: runs in the panel and under node.
 */
(function (root) {
  "use strict";

  /**
   * Read `path` as bytes.
   *
   * @param {object} cep      the host's `window.cep`
   * @param {string} path     absolute path to read
   * @param {number} [expect] byte count the caller already knows (from
   *                          File.length on the ExtendScript side). When
   *                          given, a short or long read throws.
   * @param {function} [decode] base64 decoder; defaults to the global atob.
   * @returns {Uint8Array}
   */
  function readBinary(cep, path, expect, decode) {
    if (!cep || !cep.fs || typeof cep.fs.readFile !== "function") {
      throw new Error(
        "This host does not expose cep.fs.readFile, so Capset cannot read " +
        "the audio After Effects rendered."
      );
    }
    // Deliberately not `cep.encoding && cep.encoding.Base64 || something`.
    // A guessed constant is how the original bug happened; if the host does
    // not offer base64 reads there is no safe way to continue.
    if (!cep.encoding || cep.encoding.Base64 === undefined ||
        cep.encoding.Base64 === null) {
      throw new Error(
        "This After Effects build's CEP runtime does not expose " +
        "cep.encoding.Base64, which is the only way to read a file without " +
        "decoding it as text. Capset cannot read audio safely on it."
      );
    }

    var read = cep.fs.readFile(path, cep.encoding.Base64);
    if (!read || read.err) {
      throw new Error(
        "Could not read " + path + " (error " + (read ? read.err : "no result") + ")"
      );
    }

    var atob64 = decode ||
      (typeof atob === "function" ? atob : null) ||
      (typeof root.atob === "function" ? root.atob : null);
    if (!atob64) throw new Error("No base64 decoder available in this host.");

    // atob returns a binary string: every code unit is 0x00-0xFF, so
    // charCodeAt is exact and needs no masking. (The mask in the old code was
    // the tell -- it only makes sense for a string that has been through a
    // text decoder.)
    var binary = atob64(read.data);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    if (typeof expect === "number" && expect > 0 && bytes.length !== expect) {
      throw new Error(
        "Read " + bytes.length + " bytes from " + path + " but After Effects " +
        "wrote " + expect + ". The file was altered on the way in, so the " +
        "audio would not be what you rendered. This is a bug in Capset, not " +
        "something you did — please report it."
      );
    }
    return bytes;
  }

  var api = { readBinary: readBinary };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetCepFile = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
