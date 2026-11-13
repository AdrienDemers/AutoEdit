const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const code = renderer.slice(renderer.indexOf('  function handlePlaybackShortcut(event)'), renderer.indexOf('  function togglePlayback()'));

test('Space toggles playback once and prevents scrolling, even when a timeline button has focus', () => {
  let toggles = 0;
  let prevented = 0;
  const sandbox = { activeExport: null, togglePlayback: () => toggles++ };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const event = { code: 'Space', key: ' ', target: { closest: () => null }, preventDefault: () => prevented++ };
  sandbox.handlePlaybackShortcut(event);
  sandbox.handlePlaybackShortcut({ ...event, repeat: true });
  assert.equal(toggles, 1);
  assert.equal(prevented, 2);
  sandbox.activeExport = {};
  sandbox.handlePlaybackShortcut(event);
  assert.equal(toggles, 1);
});

test('Space leaves editable controls, modifier shortcuts and already-handled events unchanged', () => {
  const sandbox = { activeExport: null, togglePlayback: () => assert.fail('Unexpected playback') };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const event = { code: 'Space', key: ' ', target: { closest: () => null }, preventDefault: () => assert.fail('Input was intercepted') };
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'defaultPrevented']) sandbox.handlePlaybackShortcut({ ...event, [modifier]: true });
  sandbox.handlePlaybackShortcut({ ...event, target: { closest: () => ({}) } });
  sandbox.handlePlaybackShortcut({ ...event, code: 'KeyA', key: 'a' });
});
