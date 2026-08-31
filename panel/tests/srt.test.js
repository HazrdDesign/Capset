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
