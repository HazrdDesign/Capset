/**
 * Reading rendered audio out of the CEP host without destroying it.
 *
 * The bug these cover shipped in v0.2.2 through v0.2.4 and cost four
 * releases' worth of misdiagnosis: `readFile(path, cep.fs.NO_ENCODING)` --
 * a constant that does not exist -- read a WAV as UTF-8 text. The failure
 * surfaced as a bogus sample rate, a duration a quarter short, a full-scale
 * peak, and zero recognised words, none of which pointed at the panel.
 */
const test = require("node:test");
const assert = require("node:assert");

const cepfile = require("../js/lib/cepfile.js");
const { makeCep, encoding, charCodesMasked } = require("./fake-cep.js");

/** A real 48 kHz stereo 16-bit WAV header plus `frames` of loud PCM. */
function makeWav(frames) {
  const dataBytes = frames * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);       // PCM
  buf.writeUInt16LE(2, 22);       // stereo
  buf.writeUInt32LE(48000, 24);   // 0x0000BB80 — the bytes the old code ate
  buf.writeUInt32LE(192000, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(30000 * Math.sin((i / 48000) * 2 * Math.PI * 220));
    buf.writeInt16LE(v, 44 + i * 4);
    buf.writeInt16LE(v, 46 + i * 4);
  }
  return new Uint8Array(buf);
}

test("reads a file back byte for byte", () => {
  const wav = makeWav(4800);
  const cep = makeCep({ "/tmp/capset_1.wav": wav });
  const got = cepfile.readBinary(cep, "/tmp/capset_1.wav", wav.length);
  assert.deepStrictEqual(Array.from(got), Array.from(wav));
});

test("every byte value survives the round trip", () => {
  // 0x80-0xFF is where a UTF-8 read does its damage; include all 256.
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  const cep = makeCep({ "/x": all });
  assert.deepStrictEqual(
    Array.from(cepfile.readBinary(cep, "/x", 256)),
    Array.from(all)
  );
});

test("the sample rate in the header is not altered", () => {
  const wav = makeWav(1000);
  const cep = makeCep({ "/a.wav": wav });
  const got = cepfile.readBinary(cep, "/a.wav", wav.length);
  const rate = Buffer.from(got.buffer, got.byteOffset, got.length)
    .readUInt32LE(24);
  assert.strictEqual(rate, 48000);
});

test("a text-mode read is what corrupts the audio — the bug this replaces", () => {
  // Not a test of our code: a test that the FAKE reproduces the host, so the
  // tests above are meaningful. If this ever stops corrupting, the fake has
  // drifted from CEP and everything else here proves nothing.
  const wav = makeWav(48000 * 5);
  const cep = makeCep({ "/a.wav": wav });
  const asText = cep.fs.readFile("/a.wav", cep.fs.NO_ENCODING); // undefined!
  const mangled = charCodesMasked(asText.data);

  assert.notStrictEqual(mangled.length, wav.length,
    "a UTF-8 read should not return the same number of bytes");
  const rate = Buffer.from(mangled.buffer, mangled.byteOffset, mangled.length)
    .readUInt32LE(24);
  assert.notStrictEqual(rate, 48000,
    "the sample rate field should be destroyed by a text read");
});

test("a short read is refused rather than transcribed", () => {
  const wav = makeWav(1000);
  const cep = makeCep({ "/a.wav": wav });
  assert.throws(
    () => cepfile.readBinary(cep, "/a.wav", wav.length + 512),
    /Read \d+ bytes .* but After Effects wrote/
  );
});

test("the expected size is optional", () => {
  const wav = makeWav(10);
  const cep = makeCep({ "/a.wav": wav });
  assert.strictEqual(cepfile.readBinary(cep, "/a.wav").length, wav.length);
  assert.strictEqual(cepfile.readBinary(cep, "/a.wav", 0).length, wav.length);
});

test("a host without base64 reads fails loudly instead of guessing", () => {
  const wav = makeWav(10);
  const cep = makeCep({ "/a.wav": wav }, { noBase64: true });
  assert.throws(
    () => cepfile.readBinary(cep, "/a.wav", wav.length),
    /cep\.encoding\.Base64/
  );
});

test("a read error is reported, not returned as empty audio", () => {
  const cep = makeCep({});
  assert.throws(
    () => cepfile.readBinary(cep, "/missing.wav", 100),
    /Could not read \/missing\.wav \(error 2\)/
  );
});

test("Base64 is the encoding actually requested", () => {
  const wav = makeWav(10);
  const seen = [];
  const cep = makeCep({ "/a.wav": wav });
  const inner = cep.fs.readFile;
  cep.fs.readFile = function (path, enc) { seen.push(enc); return inner(path, enc); };
  cepfile.readBinary(cep, "/a.wav", wav.length);
  assert.deepStrictEqual(seen, [encoding.Base64]);
});
