(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoEditAccents = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const tolerance = 0.01;
  const near = (left, right) => Math.abs(left - right) <= tolerance;
  const validTime = (time, duration) => Number.isFinite(time) && time > 0.12 && time < duration - 0.12;
  function validOverrides(value) {
    return Boolean(value && ['added', 'removed'].every((key) => Array.isArray(value[key])
      && value[key].length <= 100000 && value[key].every((time) => validTime(time, Infinity))));
  }
  function hasEdits(value) {
    return Boolean(value && (value.added.length || value.removed.length));
  }
  function effectiveCuts(detected, overrides, duration) {
    const edits = overrides || { added: [], removed: [] };
    const times = [...detected.filter((time) => !edits.removed.some((removed) => near(time, removed))
      && !edits.added.some((added) => near(time, added))), ...edits.added]
      .filter((time) => validTime(time, duration)).sort((left, right) => left - right);
    return times.filter((time, index) => !index || !near(time, times[index - 1]));
  }
  function editAccent(overrides, time, action, duration) {
    if (!Number.isFinite(time)) throw new Error('Enter a valid accent time.');
    const rounded = Number(time.toFixed(3));
    if (!validTime(rounded, duration)) throw new Error('Place accents at least 0.12 seconds from the start and end of the music.');
    if (!['add', 'remove'].includes(action)) throw new Error('Unknown accent edit.');
    const added = overrides.added.filter((value) => !near(value, rounded));
    const removed = overrides.removed.filter((value) => !near(value, rounded));
    (action === 'add' ? added : removed).push(rounded);
    return { added: added.sort((left, right) => left - right), removed: removed.sort((left, right) => left - right) };
  }
  function moveAccent(overrides, from, to, duration) {
    if (!validTime(from, duration) || !validTime(to, duration)) throw new Error('Place accents at least 0.12 seconds from the start and end of the music.');
    if (Number(from.toFixed(3)) === Number(to.toFixed(3))) return overrides;
    return editAccent(editAccent(overrides, from, 'remove', duration), to, 'add', duration);
  }
  return { near, validOverrides, hasEdits, effectiveCuts, editAccent, moveAccent };
});
