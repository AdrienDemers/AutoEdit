const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');

test('dragging a source segment maps pointer movement to source time and clamps at both ends', () => {
  const helper = renderer.slice(
    renderer.indexOf('  function sourceSlipStartAtPointer('),
    renderer.indexOf('  function updateClipSlipFromPointer(')
  );
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(helper, sandbox);

  const track = { left: 100, width: 200 };
  assert.equal(sandbox.sourceSlipStartAtPointer(160, track, 10, 20, 5), 5);
  assert.equal(sandbox.sourceSlipStartAtPointer(90, track, 10, 20, 5), 0);
  assert.equal(sandbox.sourceSlipStartAtPointer(390, track, 10, 20, 5), 15);
});

test('marking either edge from the player timestamp keeps source segment length fixed', () => {
  const helper = renderer.slice(
    renderer.indexOf('  function sourceStartForMarkedPoint('),
    renderer.indexOf('  function updateClipSlipFromPointer(')
  );
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(helper, sandbox);

  assert.equal(sandbox.sourceStartForMarkedPoint('start', 4, 12, 3), 4);
  assert.equal(sandbox.sourceStartForMarkedPoint('end', 9, 12, 3), 6);
  assert.equal(sandbox.sourceStartForMarkedPoint('start', 11, 12, 3), 9);
  assert.equal(sandbox.sourceStartForMarkedPoint('end', 2, 12, 3), 0);
});

test('slipping clamps the source range without changing the clip timeline duration', () => {
  const rendererCode = renderer.slice(
    renderer.indexOf('  function updateClipSlipView('),
    renderer.indexOf('  function handleClipSlipTrackKeydown(')
  );
  const range = { textContent: '' };
  const timelineClip = { title: '' };
  const sandbox = {
    selectedCutIndex: 2,
    clipSlipWindow: { style: {} },
    clipSlipTrack: { setAttribute() {} },
    clipSlipPreview: { readyState: 0 },
    $: (id) => id === 'clipSlipRange' ? range : { querySelector: () => timelineClip },
    formatSourceTime: (time) => `${time.toFixed(1)} s`,
    formatTime: (time) => `${time.toFixed(1)} s`
  };
  vm.createContext(sandbox);
  vm.runInContext(rendererCode, sandbox);

  const cut = { start: 3, end: 5, sourceStart: 1 };
  const video = { duration: 10, file: { name: 'camera.mp4' } };
  sandbox.updateClipSlipView(cut, video, 9.5);

  assert.equal(cut.sourceStart, 8);
  assert.equal(cut.end - cut.start, 2);
  assert.equal(sandbox.clipSlipWindow.style.left, '80%');
  assert.equal(sandbox.clipSlipWindow.style.width, '20%');
  assert.match(range.textContent, /8\.0 s.*10\.0 s/);
  assert.match(timelineClip.title, /8\.0 s/);
});

test('F opens source-segment editing only in the editing workspace and Escape closes it', () => {
  const shortcut = renderer.slice(
    renderer.indexOf('  function handleClipSlipShortcut('),
    renderer.indexOf('  function cancelPreviewRendering(')
  );
  let opened = 0;
  let closed = 0;
  let visible = false;
  const sandbox = {
    state: { workspace: 'editing' },
    activeExport: null,
    clipSlipOverlay: { classList: { contains: () => !visible } },
    openClipSlipEditor: () => { opened++; },
    closeClipSlipEditor: () => { closed++; visible = false; }
  };
  vm.createContext(sandbox);
  vm.runInContext(shortcut, sandbox);

  const event = (key, overrides = {}) => ({
    key,
    target: { closest: () => null },
    preventDefault() { this.prevented = true; },
    ...overrides
  });

  const open = event('f');
  sandbox.handleClipSlipShortcut(open);
  assert.equal(opened, 1);
  assert.equal(open.prevented, true);

  visible = true;
  const escape = event('Escape');
  sandbox.handleClipSlipShortcut(escape);
  assert.equal(closed, 1);
  assert.equal(escape.prevented, true);

  sandbox.handleClipSlipShortcut(event('f', { repeat: true }));
  sandbox.handleClipSlipShortcut(event('f', { target: { closest: () => ({}) } }));
  sandbox.state.workspace = 'analysis';
  sandbox.handleClipSlipShortcut(event('f'));
  assert.equal(opened, 1);
});
