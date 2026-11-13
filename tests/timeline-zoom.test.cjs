const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const zoomCode = renderer.slice(renderer.indexOf('  function getTimelineWindow(kind)'), renderer.indexOf('  function canEditAnalysis()'));

function harness() {
  const elements = {};
  for (const prefix of ['music', 'source']) {
    elements[`${prefix}TimelineViewport`] = { clientWidth: 582, scrollLeft: 0, getBoundingClientRect: () => ({ left: 100 }) };
    elements[`${prefix}TimelineContent`] = { style: {} };
    const parts = {};
    elements[`${prefix}TimelineNavigator`] = { querySelector: (selector) => parts[selector] ||= { style: {}, setAttribute() {} } };
  }
  const calls = [];
  const sandbox = {
    $: (id) => elements[id],
    timelineZoom: { music: 1, footage: 1 },
    maximumTimelineZoom: 64,
    trackHeaderWidth: 82,
    state: { analysisTarget: 'source' },
    getVideo: () => ({ duration: 20 }),
    duration: () => 8,
    renderRuler: () => calls.push('music-ruler'),
    drawWaveform: () => calls.push('waveform'),
    renderTimeRuler: () => calls.push('source-ruler'),
    formatSourceTime: () => {},
  };
  vm.createContext(sandbox);
  vm.runInContext(zoomCode, sandbox);
  return { sandbox, elements, calls };
}

test('Ctrl+wheel zoom anchors the mouse position and keeps music and footage zoom independent', () => {
  const { sandbox, elements, calls } = harness();
  sandbox.timelineZoom.music = 2;
  const viewport = elements.musicTimelineViewport;
  viewport.scrollLeft = 200;
  let prevented = false;
  sandbox.zoomTimeline({ ctrlKey: true, deltaY: -120, clientX: 332, preventDefault: () => { prevented = true; } }, 'music');
  assert.equal(prevented, true);
  assert.equal(sandbox.timelineZoom.music, 2.5);
  assert.equal(sandbox.timelineZoom.footage, 1);
  assert.equal(elements.musicTimelineContent.style.width, '1332px');
  assert.equal((viewport.scrollLeft + 150) / 1250, (200 + 150) / 1000);
  assert.deepEqual(calls, ['music-ruler', 'waveform']);
  sandbox.zoomTimeline({ ctrlKey: true, deltaY: -120, clientX: 332, preventDefault() {} }, 'footage');
  assert.equal(sandbox.timelineZoom.footage, 1.25);
  assert.equal(calls.at(-1), 'source-ruler');
});

test('navigator handles resize around the opposite endpoint and panning preserves the visible span', () => {
  const { sandbox, elements } = harness();
  let range = sandbox.moveTimelineWindow({ start: 0.2, end: 0.6 }, 'start', 0.1);
  assert.ok(Math.abs(range.start - 0.3) < 1e-10);
  assert.equal(range.end, 0.6);
  range = sandbox.moveTimelineWindow(range, 'end', 0.1);
  assert.equal(range.end, 0.7);
  range = sandbox.moveTimelineWindow(range, 'pan', 10);
  assert.ok(Math.abs(range.start - 0.6) < 1e-10);
  assert.equal(range.end, 1);
  const bounded = sandbox.moveTimelineWindow(range, 'start', 10);
  assert.equal(bounded.end - bounded.start, 1 / 64);
  sandbox.setTimelineWindow('music', 0.2, 0.6);
  assert.ok(Math.abs(sandbox.timelineZoom.music - 2.5) < 1e-10);
  assert.ok(Math.abs(elements.musicTimelineViewport.scrollLeft - 250) < 1e-10);
  sandbox.setTimelineWindow('music', 0, 1);
  assert.equal(sandbox.timelineZoom.music, 1);
  assert.equal(elements.musicTimelineViewport.scrollLeft, 0);
});

test('ordinary wheel scrolling is untouched and zoom stays between fit and its maximum', () => {
  const { sandbox } = harness();
  const wheel = { ctrlKey: false, deltaY: -120, clientX: 332, preventDefault: () => assert.fail('Ordinary scrolling was prevented') };
  sandbox.zoomTimeline(wheel, 'music');
  assert.equal(sandbox.timelineZoom.music, 1);
  wheel.ctrlKey = true;
  let prevented = 0;
  wheel.preventDefault = () => prevented++;
  for (let index = 0; index < 100; index++) sandbox.zoomTimeline(wheel, 'music');
  assert.equal(sandbox.timelineZoom.music, 64);
  wheel.deltaY = 120;
  for (let index = 0; index < 100; index++) sandbox.zoomTimeline(wheel, 'music');
  assert.equal(sandbox.timelineZoom.music, 1);
  assert.equal(prevented, 200);
});

test('zoomed waveform draws the visible audio slice and aligned cut lines without an oversized canvas', () => {
  const { sandbox, elements } = harness();
  const bars = [];
  sandbox.timelineZoom.music = 2;
  elements.musicTimelineViewport.scrollLeft = 250;
  elements.waveWrap = { getBoundingClientRect: () => ({ width: 1000, height: 100 }) };
  sandbox.canvas = { style: {} };
  sandbox.context = { setTransform() {}, clearRect() {}, fillRect: (...args) => bars.push(args) };
  sandbox.window = { devicePixelRatio: 2 };
  sandbox.state = { audioBuffer: { getChannelData: () => new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) }, beatTimes: [4] };
  sandbox.duration = () => 8;
  sandbox.renderMusicAccentEditor = () => {};
  sandbox.renderPlayhead = () => {};
  const drawCode = renderer.slice(renderer.indexOf('  function drawWaveform()'), renderer.indexOf('  function renderPlayhead()'));
  vm.runInContext(drawCode, sandbox);
  sandbox.drawWaveform();
  assert.equal(sandbox.canvas.width, 1000);
  assert.equal(sandbox.canvas.style.width, '500px');
  assert.equal(sandbox.canvas.style.left, '250px');
  assert.ok(Math.abs(bars[0][3] - 0.3 * 82) < 0.001);
  assert.deepEqual(bars.at(-1), [250, 0, 1, 100]);
});

test('the ruler adds readable subsecond labels when zooming into short clips', () => {
  const { sandbox } = harness();
  sandbox.timelineZoom.music = 64;
  const code = renderer.slice(renderer.indexOf('  function renderTimeRuler('), renderer.indexOf('  function renderVideoTrack()'));
  vm.runInContext(code, sandbox);
  const ruler = { id: 'timeRuler', innerHTML: '' };
  sandbox.renderTimeRuler(ruler, 8, (seconds) => `00:${String(seconds).padStart(2, '0')}`);
  assert.match(ruler.innerHTML, />00:00\.05</);
  assert.match(ruler.innerHTML, />00:00\.10</);
});
