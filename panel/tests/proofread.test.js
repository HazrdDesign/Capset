/**
 * The Proofread tab's logic: timecode, problem flags, and the edits it sends.
 */
const test = require("node:test");
const assert = require("node:assert");
const pr = require("../js/lib/proofread.js");

const comp = (frameRate = 30, extra = {}) =>
  Object.assign({ frameRate, frameDuration: 1 / frameRate, displayStartTime: 0,
                  dropFrame: false, duration: 60 }, extra);

const row = (text, start, end, i = 1) =>
  ({ ref: { compId: 1, index: i }, text, start, end });

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg || a + " != " + b);

// --- timecode ----------------------------------------------------------------

test("seconds format as After Effects timecode", () => {
  assert.strictEqual(pr.formatTimecode(0, comp()), "00:00:00:00");
  assert.strictEqual(pr.formatTimecode(4.4, comp()), "00:00:04:12");
  assert.strictEqual(pr.formatTimecode(3725.48, comp(25)), "01:02:05:12");
  assert.strictEqual(pr.formatTimecode(1 / 24 * 23, comp(24)), "00:00:00:23");
});

test("frame times carried as awkward floats land on their frame", () => {
  // After Effects hands back 2.0 seconds as 1.9999999999999998.
  assert.strictEqual(pr.formatTimecode(1.9999999999999998, comp()), "00:00:02:00");
});

test("the comp's display start time is part of the timecode", () => {
  const c = comp(25, { displayStartTime: 3600 });
  assert.strictEqual(pr.formatTimecode(1, c), "01:00:01:00");
  close(pr.parseTimecode("01:00:01:00", c).seconds, 1);
});

test("typed timecode round-trips at every common rate", () => {
  [23.976, 24, 25, 29.97, 30, 50, 59.94, 60].forEach((rate) => {
    const c = comp(rate);
    for (let f = 0; f < 5000; f += 37) {
      const seconds = f / rate;
      const tc = pr.formatTimecode(seconds, c);
      const back = pr.parseTimecode(tc, c);
      assert.ok(!back.error, tc + ": " + back.error);
      close(back.seconds, seconds, rate + " fps, frame " + f + " (" + tc + ")");
    }
  });
});

test("drop-frame comps skip the labels After Effects skips", () => {
  const c = comp(29.97, { dropFrame: true });
  // One real minute of frames is labelled 00;01;00;02 -- ;00 and ;01 do not
  // exist -- and the tenth minute is not dropped. Semicolons throughout, as
  // After Effects writes drop-frame timecode.
  assert.strictEqual(pr.formatTimecode(1799 / 29.97, c), "00;00;59;29");
  assert.strictEqual(pr.formatTimecode(1800 / 29.97, c), "00;01;00;02");
  assert.strictEqual(pr.formatTimecode(17982 / 29.97, c), "00;10;00;00");
  close(pr.parseTimecode("00;01;00;02", c).seconds, 1800 / 29.97);
  close(pr.parseTimecode("00;10;00;00", c).seconds, 17982 / 29.97);

  // Round trip across several minutes, including every minute boundary.
  for (let f = 0; f < 40000; f += 13) {
    const tc = pr.formatTimecode(f / 29.97, c);
    close(pr.parseTimecode(tc, c).seconds, f / 29.97, "frame " + f + " = " + tc);
  }
});

test("a drop-frame flag on a whole-number rate means nothing", () => {
  assert.strictEqual(pr.formatTimecode(60, comp(30, { dropFrame: true })), "00:01:00:00");
});

test("short and digit-only timecode is read the way After Effects reads it", () => {
  const c = comp();
  close(pr.parseTimecode("4:12", c).seconds, 4.4);
  close(pr.parseTimecode("412", c).seconds, 4.4);
  close(pr.parseTimecode("100", c).seconds, 1);
  close(pr.parseTimecode("12", c).seconds, 0.4);
  close(pr.parseTimecode("1:00:00", c).seconds, 60);
  close(pr.parseTimecode(" 00:00:04:12 ", c).seconds, 4.4);
  // Overflow carries: 45 frames at 30 fps is 1s 15f.
  close(pr.parseTimecode("0:45", c).seconds, 1.5);
});

test("frame nudges and seconds are accepted too", () => {
  const c = comp();
  close(pr.parseTimecode("+3", c, 4).seconds, 4.1);
  close(pr.parseTimecode("-30", c, 4).seconds, 3);
  close(pr.parseTimecode("4.5s", c).seconds, 4.5);
  // Seconds snap to the frame.
  close(pr.parseTimecode("4.51s", c).seconds, 4.5);
});

test("bad timecode says what is wrong instead of guessing", () => {
  const c = comp();
  assert.match(pr.parseTimecode("", c).error, /Type a timecode/);
  assert.match(pr.parseTimecode("soon", c).error, /not a timecode/);
  assert.match(pr.parseTimecode("1:2:3:4:5", c).error, /not a timecode/);
  assert.match(pr.parseTimecode("123456789", c).error, /too many digits/);
  assert.match(pr.parseTimecode("-40", c, 1).error, /before the composition/);
  assert.match(pr.parseTimecode("+3", c).error, /Nothing to nudge/);
});

// --- retyping and retiming ---------------------------------------------------

test("an unchanged caption produces no edit", () => {
  assert.strictEqual(pr.retext(row("Hello there", 0, 1), "  Hello there \n"), null);
});

test("a retyped caption carries what it expects to find", () => {
  const r = row("Helo", 1, 2);
  const out = pr.retext(r, "Hello");
  assert.deepStrictEqual(out.edit, {
    ref: r.ref, expect: { text: "Helo", start: 1, end: 2 }, text: "Hello"
  });
});

test("line breaks survive retyping, stray spaces around them do not", () => {
  const out = pr.retext(row("a b", 0, 1), "top line \r\n  bottom line");
  assert.strictEqual(out.edit.text, "top line\nbottom line");
});

test("a caption cannot be emptied by retyping", () => {
  assert.match(pr.retext(row("Hi", 0, 1), "  \n ").error, /cannot be empty/);
});

test("retiming snaps to a frame and keeps at least one", () => {
  const c = comp();
  const r = row("x", 1, 2);
  close(pr.retime(r, "end", 2.51, c).edit.end, 2.5);
  assert.strictEqual(pr.retime(r, "start", 1.01, c), null, "sub-frame change is no change");
  assert.match(pr.retime(r, "start", 2, c).error, /after the caption ends/);
  assert.match(pr.retime(r, "end", 0.5, c).error, /before the caption starts/);
  assert.ok(pr.retime(r, "start", 2 - 1 / 30, c).edit, "one frame long is allowed");
});

// --- problem flags -----------------------------------------------------------

const kinds = (issues) => issues.map((list) => list.map((i) => i.kind));

test("clean, contiguous captions raise nothing", () => {
  const rows = [row("one two", 0, 1), row("three four", 1, 2), row("five", 3, 4)];
  assert.deepStrictEqual(kinds(pr.findIssues(rows, comp())), [[], [], []]);
});

test("an overlap is flagged on the caption that runs on", () => {
  const issues = pr.findIssues([row("a b", 0, 1.1), row("c d", 1, 2)], comp());
  assert.deepStrictEqual(kinds(issues), [["overlap"], []]);
  assert.match(issues[0][0].message, /3 frames/);
});

test("a one or two frame gap is a flicker, a longer one is a pause", () => {
  const c = comp();
  const gap = (frames) =>
    kinds(pr.findIssues([row("a b", 0, 1), row("c d", 1 + frames / 30, 2)], c))[0];
  assert.deepStrictEqual(gap(1), ["flicker"]);
  assert.deepStrictEqual(gap(pr.FLICKER_FRAMES), ["flicker"]);
  assert.deepStrictEqual(gap(pr.FLICKER_FRAMES + 1), []);
  assert.deepStrictEqual(gap(0), []);
});

test("a caption gone in a blink is flagged", () => {
  assert.deepStrictEqual(kinds(pr.findIssues([row("hi", 0, 0.1)], comp())), [["short"]]);
  assert.deepStrictEqual(kinds(pr.findIssues([row("hi", 0, pr.MIN_DURATION)], comp())), [[]]);
});

test("reading speed is flagged, but not on single-word captions", () => {
  const c = comp();
  // 42 characters in one second.
  const fast = row("This is far too much text to read at once", 0, 1);
  assert.deepStrictEqual(kinds(pr.findIssues([fast], c)), [["fast"]]);
  // Word-by-word captions are short by design.
  assert.deepStrictEqual(kinds(pr.findIssues([row("Extraordinarily", 0, 0.4)], c)), [[]]);
  // Same text with time to read it.
  assert.deepStrictEqual(kinds(pr.findIssues([row(fast.text, 0, 3)], c)), [[]]);
});

test("fixing overlaps pulls the out point back and closes blinks", () => {
  const c = comp();
  const rows = [row("a b", 0, 1.2, 1), row("c d", 1, 2, 2),
                row("e f", 2 + 1 / 30, 3, 3), row("g h", 4, 5, 4)];
  const { edits, unfixed } = pr.fixOverlaps(rows, c);
  assert.deepStrictEqual(unfixed, []);
  assert.deepStrictEqual(edits.map((e) => e.ref.index), [1, 2]);
  close(edits[0].end, 1);
  close(edits[1].end, 2 + 1 / 30);
  // Nothing is left to fix afterwards.
  const after = rows.map((r) => Object.assign({}, r));
  after[0].end = edits[0].end;
  after[1].end = edits[1].end;
  assert.deepStrictEqual(kinds(pr.findIssues(after, c)).flat(), []);
});

test("a caption the next one starts on top of is reported, not erased", () => {
  const { edits, unfixed } = pr.fixOverlaps([row("a b", 1, 2), row("c d", 1, 3)], comp());
  assert.deepStrictEqual(edits, []);
  assert.deepStrictEqual(unfixed, [0]);
});

// --- time shift --------------------------------------------------------------

test("shifting moves every caption from the chosen one by whole frames", () => {
  const rows = [row("a", 0, 1, 1), row("b", 1, 2, 2), row("c", 2, 3, 3)];
  const all = pr.shift(rows, 0, 3, comp());
  assert.strictEqual(all.edits.length, 3);
  all.edits.forEach((e) => close(e.shiftBy, 0.1));

  const tail = pr.shift(rows, 1, -2.4, comp());
  assert.deepStrictEqual(tail.edits.map((e) => e.ref.index), [2, 3]);
  close(tail.edits[0].shiftBy, -2 / 30);
});

test("a shift that would run off the front of the comp is refused", () => {
  const rows = [row("a", 0.1, 1), row("b", 1, 2)];
  assert.match(pr.shift(rows, 0, -4, comp()).error, /before the composition.*3 frames/);
  assert.ok(pr.shift(rows, 0, -3, comp()).edits);
  assert.match(pr.shift(rows, 0, 0, comp()).error, /how many frames/);
  assert.match(pr.shift(rows, 5, 1, comp()).error, /No captions/);
});

// --- find and replace --------------------------------------------------------

test("find is case-insensitive unless asked, and reads across line breaks", () => {
  const rows = [row("Hello Kate", 0, 1), row("see\nyou", 1, 2), row("kate!", 2, 3)];
  assert.deepStrictEqual(pr.find(rows, "kate", false), [0, 2]);
  assert.deepStrictEqual(pr.find(rows, "kate", true), [2]);
  assert.deepStrictEqual(pr.find(rows, "see you", false), [1]);
  assert.deepStrictEqual(pr.find(rows, "", false), []);
});

test("replace all fixes every occurrence and counts them", () => {
  const rows = [row("Kate and kate", 0, 1, 1), row("no match", 1, 2, 2),
                row("top\nKate", 2, 3, 3)];
  const out = pr.replaceAll(rows, "kate", "Cate", false);
  assert.strictEqual(out.count, 3);
  assert.deepStrictEqual(out.edits.map((e) => e.text), ["Cate and Cate", "top\nCate"]);
  assert.deepStrictEqual(out.edits[0].expect, { text: "Kate and kate", start: 0, end: 1 });

  const cased = pr.replaceAll(rows, "kate", "Cate", true);
  assert.deepStrictEqual(cased.edits.map((e) => e.text), ["Kate and Cate"]);
});

test("replacing across a line break joins the lines", () => {
  const out = pr.replaceAll([row("see\nyou later", 0, 1)], "see you", "bye", false);
  assert.strictEqual(out.edits[0].text, "bye later");
});

test("replacing a word with nothing leaves no double space", () => {
  const out = pr.replaceAll([row("um so um yes", 0, 1)], "um", "", true);
  assert.strictEqual(out.edits[0].text, "so yes");
});

test("replace all refuses to empty a caption", () => {
  const out = pr.replaceAll([row("Um", 0, 1), row("um yes", 1, 2)], "um", "", false);
  assert.match(out.error, /1 caption empty/);
  assert.match(pr.replaceAll([row("x", 0, 1)], "", "y").error, /find first/);
});

// --- split and merge ---------------------------------------------------------

test("split puts the time in proportion to the text, on a frame", () => {
  const c = comp();
  const out = pr.splitAt(row("aaaa bbbbbbbbbbbb", 1, 3), 4, c);
  assert.strictEqual(out.first.text, "aaaa");
  assert.strictEqual(out.second.text, "bbbbbbbbbbbb");
  close(out.first.start, 1);
  close(out.second.end, 3);
  close(out.first.end, out.second.start);
  // 4 of 16 characters: a quarter of the way through two seconds.
  close(out.first.end, 1.5);
});

test("split keeps a frame on each side, and needs two to start with", () => {
  const c = comp();
  const out = pr.splitAt(row("a bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", 0, 3 / 30), 1, c);
  close(out.first.end, 1 / 30);
  assert.match(pr.splitAt(row("a b", 0, 1 / 30), 1, c).error, /one frame long/);
});

test("split at either end, or on whitespace only, is refused", () => {
  const c = comp();
  assert.match(pr.splitAt(row("hello", 0, 1), 0, c).error, /between the words/);
  assert.match(pr.splitAt(row("hello", 0, 1), 5, c).error, /between the words/);
  // A cursor after the break of a two-line caption splits the lines.
  const lines = pr.splitAt(row("top\nbottom", 0, 1), 4, c);
  assert.deepStrictEqual([lines.first.text, lines.second.text], ["top", "bottom"]);
});

test("merge joins text and spans both captions", () => {
  const out = pr.merge(row("First part", 1, 2), row(" second\npart ", 2, 3.5));
  assert.deepStrictEqual(out, { text: "First part second\npart", start: 1, end: 3.5 });
});
