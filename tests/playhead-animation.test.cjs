const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const code = renderer.slice(renderer.indexOf('  function startPlayheadAnimation()'), renderer.indexOf('  function closePreviewContextMenu()'));

test('playhead updates at animation cadence using the active media clock, without duplicate loops or extrapolation', () => {
  const frames = new Map();
  const samples = [];
  let nextId = 0;
  let sourceMode = false;
  const sandbox = {
    playheadAnimationFrameId: null,
    activeExport: null,
    musicPlayer: { paused: false, ended: false, currentTime: 1 },
    activePreviewVideo: { paused: false, ended: false, currentTime: 4 },
    sourceAnalysisMode: () => sourceMode,
    syncPreview: () => samples.push((sourceMode ? sandbox.activePreviewVideo : sandbox.musicPlayer).currentTime),
    requestAnimationFrame: (callback) => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: (id) => frames.delete(id)
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const tick = () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
  };
  sandbox.startPlayheadAnimation();
  sandbox.startPlayheadAnimation();
  assert.equal(frames.size, 1);
  tick();
  sandbox.musicPlayer.currentTime = 1.016;
  tick();
  tick();
  assert.deepEqual(samples, [1, 1.016, 1.016]);
  sourceMode = true;
  tick();
  assert.equal(samples.at(-1), 4);
  sandbox.activePreviewVideo.paused = true;
  tick();
  assert.equal(frames.size, 0);
  sandbox.activePreviewVideo.paused = false;
  sandbox.startPlayheadAnimation();
  sandbox.stopPlayheadAnimation();
  assert.equal(frames.size, 0);
  sandbox.activeExport = {};
  sandbox.startPlayheadAnimation();
  assert.equal(frames.size, 0);
});

test('editing playhead aligns to the timeline content after the sticky track header', () => {
  const renderCode = renderer.slice(
    renderer.indexOf('  function renderPlayhead()'),
    renderer.indexOf('  function exportEdit()')
  );
  const elements = {
    playhead: { style: {} },
    timelinePlayhead: { style: {} },
    musicTimelineContent: { clientWidth: 1000 }
  };
  const sandbox = {
    duration: () => 10,
    musicPlayer: { currentTime: 5 },
    trackHeaderWidth: 82,
    $: (id) => elements[id]
  };
  vm.createContext(sandbox);
  vm.runInContext(renderCode, sandbox);
  sandbox.renderPlayhead();

  assert.equal(elements.playhead.style.left, '50%');
  assert.equal(elements.timelinePlayhead.style.left, '541px');
});
