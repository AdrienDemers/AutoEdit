const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const accents = require('../shared/music-accents.js');
const footage = require('../shared/footage-analysis.js');

test('manual accents override nearby detections and survive changed cadence, re-analysis and serialization', () => {
  let edits = { added: [], removed: [] };
  edits = accents.editAccent(edits, 1.235, 'add', 10);
  edits = accents.editAccent(edits, 2, 'remove', 10);
  assert.deepEqual(accents.effectiveCuts([1.23, 2, 3], edits, 10), [1.235, 3]);
  assert.deepEqual(accents.effectiveCuts([1.236, 2.003, 4], JSON.parse(JSON.stringify(edits)), 10), [1.235, 4]);
  assert.deepEqual(accents.effectiveCuts([1.23, 2, 3], { added: [], removed: [] }, 10), [1.23, 2, 3]);
});

test('adding then removing an accent leaves it suppressed without duplicate or conflicting overrides', () => {
  let edits = accents.editAccent({ added: [], removed: [] }, 3.125, 'add', 10);
  edits = accents.editAccent(edits, 3.125, 'remove', 10);
  assert.deepEqual(edits, { added: [], removed: [3.125] });
  assert.deepEqual(accents.effectiveCuts([3.125], edits, 10), []);
  edits = accents.editAccent(edits, 3.125, 'add', 10);
  assert.deepEqual(edits, { added: [3.125], removed: [] });
  for (const time of [NaN, -1, 0.12, 9.88]) assert.throws(() => accents.editAccent(edits, time, 'add', 10));
  assert.equal(accents.validOverrides({ added: ['1'], removed: [] }), false);
});

test('moving detected and manual accents keeps the original detection suppressed through re-analysis', () => {
  const original = { added: [], removed: [] };
  const moved = accents.moveAccent(original, 2, 3.125, 10);
  assert.deepEqual(original, { added: [], removed: [] });
  assert.deepEqual(accents.effectiveCuts([2, 4, 6], moved, 10), [3.125, 4, 6]);
  const movedAgain = accents.moveAccent(moved, 3.125, 5.25, 10);
  assert.deepEqual(accents.effectiveCuts([2.003, 4, 6], JSON.parse(JSON.stringify(movedAgain)), 10), [4, 5.25, 6]);
  assert.deepEqual(accents.effectiveCuts([2, 4, 6], accents.moveAccent(original, 2, 4, 10), 10), [4, 6]);
  assert.equal(accents.moveAccent(original, 2, 2, 10), original);
  for (const time of [NaN, 0.12, 9.88]) assert.throws(() => accents.moveAccent(original, 2, time, 10));
  assert.deepEqual(original, { added: [], removed: [] });
});

test('Delete removes a selected music marker in Editing but does not intercept form-field editing', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const start = app.indexOf('  function handleWorkspaceDeleteShortcut(');
  const end = app.indexOf('  window.addEventListener(\'keydown\', (event) => {', start);
  const code = app.slice(start, end);
  const calls = [];
  const sandbox = {
    state: { workspace: 'editing' },
    selectedAccentTime: 2.5,
    sourceAnalysisMode: () => false,
    removeSelectedMusicAccent: () => calls.push('remove'),
    saveFootageRange() {},
    selectedRangeIndex: null
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  let prevented = false;
  sandbox.handleWorkspaceDeleteShortcut({
    key: 'Delete',
    target: { closest: () => null },
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.deepEqual(calls, ['remove']);

  prevented = false;
  sandbox.handleWorkspaceDeleteShortcut({
    key: 'Delete',
    target: { closest: () => ({}) },
    preventDefault: () => { prevented = true; }
  });
  assert.equal(prevented, false);
  assert.deepEqual(calls, ['remove']);
});

test('removing every accent creates one uncut interval, not fallback cuts; untouched projects retain fallback', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const code = app.slice(app.indexOf('  function rebuildAutomaticEdit('), app.indexOf('  function setFrameIndicator('));
  const assemble = (overrides, tempoBpm = 0) => {
    const sandbox = {
      state: {
        videos: [{ id: 'camera', duration: 30 }], beatTimes: [], musicEnergy: [], tempoBpm,
        musicCutOverrides: overrides, useFootageAnalysis: false
      },
      accents, footage, duration: () => 10, $: () => ({ value: '2' }),
      clearSelectedClip() {},
      setExportAvailability() {}, renderVideoTrack() {}, showNotice() {}, drawWaveform() {}, syncPreview() {}, persistSession() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    sandbox.rebuildAutomaticEdit();
    return JSON.parse(JSON.stringify(sandbox.state.edit));
  };
  assert.deepEqual(assemble({ added: [], removed: [2, 4, 6] }).map(({ start, end }) => ({ start, end })), [{ start: 0, end: 10 }]);
  assert.equal(assemble({ added: [], removed: [] }, 120).length, 1);
  assert.equal(assemble({ added: [], removed: [] }).length, 4);
});
