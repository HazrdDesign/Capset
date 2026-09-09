/**
 * User-saved animation presets.
 *
 * A preset is a complete animation definition — the same shape as an entry in
 * animations.json — optionally carrying a captured text style. Saving one
 * writes JSON to the user's data directory; nothing is stored in the
 * extension folder, which lives under Program Files and is replaced wholesale
 * on every upgrade.
 *
 * Pure: no DOM, no file system. The caller supplies read and write functions,
 * which is what makes this testable and what keeps the CEP file API out of
 * the merge logic.
 */
(function (root) {
  "use strict";

  var FILE_VERSION = 1;
  var MAX_NAME = 60;

  function trim(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/^\s+|\s+$/g, "");
  }

  /** Stable, collision-resistant enough for a single user's own presets. */
  function makeId(name, now) {
    var slug = trim(name).toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 32);
    return "user-" + (slug || "preset") + "-" +
           (now === undefined ? Date.now() : now).toString(36);
  }

  /**
   * Turn a selected animation plus a name into a saveable preset.
   *
   * The animation is copied, not referenced: editing a built-in later must not
   * silently change what a user saved, and a preset that carries a live
   * reference would break the moment the library ships a new version.
   */
  function fromAnimation(animation, options) {
    options = options || {};
    var name = trim(options.name);
    if (!name) throw new Error("Give the preset a name.");
    if (name.length > MAX_NAME) name = name.slice(0, MAX_NAME);
    if (!animation) throw new Error("Pick an animation to save.");

    var preset = JSON.parse(JSON.stringify(animation));
    preset.id = options.id || makeId(name, options.now);
    preset.name = name;
    preset.custom = true;
    preset.basedOn = preset.basedOn || "characters";
    preset.description = trim(options.description) ||
      ("Saved from " + (animation.name || animation.id || "an animation") + ".");
    preset.savedFrom = animation.id || null;
    if (options.style) preset.style = JSON.parse(JSON.stringify(options.style));
    return preset;
  }

  /** Accept only what the panel can actually render and apply. */
  function isUsable(preset) {
    if (!preset || typeof preset !== "object") return false;
    if (!trim(preset.id) || !trim(preset.name)) return false;
    var phases = ["in", "out"];
    for (var i = 0; i < phases.length; i++) {
      var phase = preset[phases[i]];
      if (phase === undefined || phase === null) continue;
      if (typeof phase !== "object") return false;
      if (phase.properties !== undefined && !(phase.properties instanceof Array)) {
        return false;
      }
    }
    return true;
  }

  /** Parse a presets file, discarding anything malformed rather than throwing. */
  function parse(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // A truncated or hand-edited file must not take the panel down with it.
      return [];
    }
    var list = parsed && parsed.presets instanceof Array ? parsed.presets : [];
    var kept = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var preset = list[i];
      if (!isUsable(preset)) continue;
      if (seen[preset.id]) continue;
      seen[preset.id] = true;
      preset.custom = true;
      kept.push(preset);
    }
    return kept;
  }

  function serialize(presets) {
    return JSON.stringify({ version: FILE_VERSION, presets: presets }, null, 2);
  }

  /**
   * Add or replace a preset by id.
   *
   * Saving over an existing name replaces it rather than accumulating
   * near-duplicates, which is what a user means by saving twice.
   */
  function upsert(presets, preset) {
    var out = [];
    var replaced = false;
    for (var i = 0; i < presets.length; i++) {
      var existing = presets[i];
      var matches = existing.id === preset.id ||
          trim(existing.name).toLowerCase() === trim(preset.name).toLowerCase();
      // Replace the FIRST match and keep everything else, including any
      // further entries sharing the name. Skipping them collapsed a list that
      // already held two presets called "Punch" down to one, silently
      // discarding the other -- and a saved preset the user cannot see is
      // gone the moment the file is written back.
      if (matches && !replaced) {
        out.push(preset);
        replaced = true;
      } else {
        out.push(existing);
      }
    }
    if (!replaced) out.push(preset);
    return out;
  }

  function remove(presets, id) {
    var out = [];
    for (var i = 0; i < presets.length; i++) {
      if (presets[i].id !== id) out.push(presets[i]);
    }
    return out;
  }

  /**
   * The library the panel shows: built-ins first, then the user's own.
   *
   * A user preset whose id collides with a built-in wins — that is the only
   * way to override a shipped animation, and losing silently to the built-in
   * would look like saving had failed.
   */
  function merge(builtIns, presets) {
    var byId = {};
    var i;
    for (i = 0; i < presets.length; i++) byId[presets[i].id] = true;
    var out = [];
    for (i = 0; i < builtIns.length; i++) {
      if (!byId[builtIns[i].id]) out.push(builtIns[i]);
    }
    for (i = 0; i < presets.length; i++) out.push(presets[i]);
    return out;
  }

  var api = {
    fromAnimation: fromAnimation,
    isUsable: isUsable,
    parse: parse,
    serialize: serialize,
    upsert: upsert,
    remove: remove,
    merge: merge,
    makeId: makeId,
    FILE_VERSION: FILE_VERSION,
    MAX_NAME: MAX_NAME
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CapsetPresets = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
