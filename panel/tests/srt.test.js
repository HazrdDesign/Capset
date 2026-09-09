const test = require("node:test");
const assert = require("node:assert");
const srt = require("../js/lib/srt.js");

const SAMPLE = `1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,250
Second caption
on two lines
`;

test("parses a basic SRT file", () => {
  const { captions, errors } = srt.parse(SAMPLE);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(captions.length, 2);
  assert.strictEqual(captions[0].text, "Hello world");
  assert.strictEqual(captions[0].start, 1.0);
  assert.strictEqual(captions[0].end, 3.5);
});

test("keeps multi-line cues as separate display lines", () => {
  const { captions } = srt.parse(SAMPLE);
  assert.deepStrictEqual(captions[1].lines, ["Second caption", "on two lines"]);
  assert.strictEqual(captions[1].text, "Second caption on two lines");
});

test("accepts WebVTT dot-separated milliseconds and a header", () => {
  const vtt = "WEBVTT\n\n00:00:02.500 --> 00:00:04.000\nVTT cue\n";
  const { captions, errors } = srt.parse(vtt);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(captions.length, 1);
  assert.strictEqual(captions[0].start, 2.5);
  assert.strictEqual(captions[0].text, "VTT cue");
});

test("accepts VTT cues with no hours field", () => {
  const { captions } = srt.parse("WEBVTT\n\n01:30.000 --> 01:32.000\nNo hours\n");
  assert.strictEqual(captions.length, 1);
  assert.strictEqual(captions[0].start, 90);
});

test("handles CRLF line endings", () => {
  const { captions } = srt.parse(SAMPLE.replace(/\n/g, "\r\n"));
  assert.strictEqual(captions.length, 2);
});

test("strips a byte order mark", () => {
  const { captions } = srt.parse("﻿" + SAMPLE);
  assert.strictEqual(captions.length, 2);
  assert.strictEqual(captions[0].text, "Hello world");
});

test("strips inline formatting tags", () => {
  const { captions } = srt.parse("1\n00:00:01,000 --> 00:00:02,000\n<i>Italic</i> text\n");
  assert.strictEqual(captions[0].text, "Italic text");
});

test("reports malformed blocks instead of silently dropping them", () => {
  const bad = "1\nno timecode here\nSome text\n\n2\n00:00:01,000 --> 00:00:02,000\nGood\n";
  const { captions, errors } = srt.parse(bad);
  assert.strictEqual(captions.length, 1);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /timecode/);
});

test("rejects a cue that ends before it starts", () => {
  const { captions, errors } = srt.parse("1\n00:00:05,000 --> 00:00:02,000\nBackwards\n");
  assert.strictEqual(captions.length, 0);
  assert.match(errors[0], /ends before/);
});

test("skips a timecode with no text", () => {
  const { captions, errors } = srt.parse("1\n00:00:01,000 --> 00:00:02,000\n\n");
  assert.strictEqual(captions.length, 0);
  assert.strictEqual(errors.length, 1);
});

test("returns cues in chronological order regardless of file order", () => {
  const out = srt.parse(
    "2\n00:00:10,000 --> 00:00:11,000\nLater\n\n1\n00:00:01,000 --> 00:00:02,000\nEarlier\n"
  );
  assert.deepStrictEqual(out.captions.map((c) => c.text), ["Earlier", "Later"]);
});

test("empty input is not an error", () => {
  assert.deepStrictEqual(srt.parse("").captions, []);
  assert.deepStrictEqual(srt.parse(null).captions, []);
});

test("millisecond precision is interpreted by digit count", () => {
  const out = srt.parse("1\n00:00:01,5 --> 00:00:02,50\nx\n");
  assert.strictEqual(out.captions[0].start, 1.5);
  assert.strictEqual(out.captions[0].end, 2.5);
});

// --- writing ----------------------------------------------------------------

test("timecodes round to the nearest millisecond, not down", () => {
  // After Effects reports times derived from frames, so an in-point on frame
  // 60 at 30fps arrives as 1.9999999999999998. Truncating writes 00:00:01,999
  // for a caption that starts at exactly two seconds.
  assert.strictEqual(srt.toTimecode(1.9999999999999998), "00:00:02,000");
  assert.strictEqual(srt.toTimecode(0.0333333333333333), "00:00:00,033");
  assert.strictEqual(srt.toTimecode(0), "00:00:00,000");
  assert.strictEqual(srt.toTimecode(3661.5), "01:01:01,500");
  // Negative times cannot be expressed in SRT and are clamped, not wrapped
  // into an hour of 59:59.
  assert.strictEqual(srt.toTimecode(-1), "00:00:00,000");
});

test("cues are numbered from one in time order", () => {
  // Layer order in After Effects is not caption order, and a player reading a
  // file whose cues run backwards shows nothing at all.
  const text = srt.format([
    { text: "third", start: 5, end: 6 },
    { text: "first", start: 0, end: 1 },
    { text: "second", start: 2, end: 3 }
  ]);
  const numbers = text.split("\r\n").filter((l) => /^\d+$/.test(l));
  assert.deepStrictEqual(numbers, ["1", "2", "3"]);
  assert.ok(text.indexOf("first") < text.indexOf("second"));
  assert.ok(text.indexOf("second") < text.indexOf("third"));
});

test("multi-line captions keep their line breaks", () => {
  const text = srt.format([{ lines: ["two", "lines"], start: 0, end: 1 }]);
  assert.ok(text.includes("two\r\nlines"), text);
});

test("a caption with no duration still produces a valid cue", () => {
  // A zero-length cue is invalid SRT; dropping it would silently lose a
  // caption the user can see on their timeline.
  const text = srt.format([{ text: "blink", start: 1, end: 1 }]);
  assert.ok(/00:00:01,000 --> 00:00:01,001/.test(text), text);
});

test("captions with no text are skipped without breaking the numbering", () => {
  const text = srt.format([
    { text: "one", start: 0, end: 1 },
    { text: "   ", start: 1, end: 2 },
    { text: "two", start: 2, end: 3 }
  ]);
  assert.deepStrictEqual(text.split("\r\n").filter((l) => /^\d+$/.test(l)), ["1", "2"]);
});

test("what we write, we can read back", () => {
  // The two halves of this module have to agree, and a round trip is the only
  // check that proves it.
  const captions = [
    { lines: ["Hi everyone."], start: 0.0333333, end: 1.9999999 },
    { lines: ["Welcome back", "to the channel."], start: 2, end: 4.5 }
  ];
  const parsed = srt.parse(srt.format(captions)).captions;
  assert.strictEqual(parsed.length, 2);
  assert.deepStrictEqual(parsed.map((c) => c.lines), [
    ["Hi everyone."], ["Welcome back", "to the channel."]
  ]);
  assert.deepStrictEqual(parsed.map((c) => [c.start, c.end]), [[0.033, 2], [2, 4.5]]);
});

test("an empty caption list is an empty file, not a broken one", () => {
  assert.strictEqual(srt.format([]), "");
  assert.strictEqual(srt.format(null), "");
});
