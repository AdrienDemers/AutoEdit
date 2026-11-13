const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const players = [];
  const errors = [];
  const timers = new Map();
  let now = 0;
  let nextId = 0;
  class Player {
    constructor() {
      this.readyState = 2;
      this.duration = 20;
      this.currentTime = 0;
      this.seeking = false;
      this.paused = true;
      this.calls = [];
      this.listeners = new Map();
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    emit(name) { this.listeners.get(name)?.(); }
    play() {
      this.calls.push({ time: this.currentTime, volume: this.volume });
      this.paused = false;
      return this.promise || Promise.resolve();
    }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  }
  const sandbox = {
    module: { exports: {} },
    document: { createElement: () => { const player = new Player(); players.push(player); return player; } },
    setTimeout: (callback, ms) => { timers.set(++nextId, { callback, at: now + ms }); return nextId; },
    clearTimeout: (id) => timers.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'audio-scrubber.js'), 'utf8'), sandbox);
  const scrubber = new sandbox.module.exports((error) => errors.push(error.message));
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
  async function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.callback();
      await flush();
    }
    now = end;
  }
  return { scrubber, players, errors, advance, flush };
}
const track = (time, extra = {}) => ({ key: 'music', url: 'music.wav', volume: 0.25, time, ...extra });

test('scrub grains use the requested volume, coalesce rapid moves and seek backwards without overlapping playback', async () => {
  const { scrubber, players, advance, flush, errors } = harness();
  scrubber.preview([track(5)]);
  await flush();
  assert.deepEqual(players[0].calls, [{ time: 5, volume: 0.25 }]);
  await advance(30);
  scrubber.preview([track(7)]);
  scrubber.preview([track(3)]);
  assert.equal(players[0].calls.length, 1);
  await advance(90);
  assert.deepEqual(players[0].calls.at(-1), { time: 3, volume: 0.25 });
  scrubber.stop();
  await advance(1000);
  assert.equal(players[0].paused, true);
  assert.equal(players[0].calls.length, 2);
  assert.deepEqual(errors, []);
});

test('muting, source changes and stopping cancel pending audio; stale play completion cannot restart grains', async () => {
  const { scrubber, players, advance, flush, errors } = harness();
  scrubber.preview([track(5, { volume: 0 })]);
  assert.equal(players.length, 0);
  scrubber.preview([track(5)]);
  await flush();
  scrubber.preview([track(8, { key: 'source', url: 'source.mp4', volume: 0.65, end: 8.02 })]);
  await flush();
  assert.equal(players[0].paused, true);
  assert.equal(players[0].src, '');
  await advance(20);
  assert.equal(players[1].paused, true);
  let finishPlay;
  players[1].promise = new Promise((resolve) => { finishPlay = resolve; });
  scrubber.preview([track(9, { key: 'source', url: 'source.mp4' })]);
  scrubber.stop();
  finishPlay();
  await flush();
  await advance(1000);
  assert.equal(players[1].paused, true);
  assert.equal(players[1].calls.length, 2);
  assert.deepEqual(errors, []);
});

test('metadata uses the latest position, idle movement stops audio and decode failures are surfaced', async () => {
  const { scrubber, players, advance, flush, errors } = harness();
  scrubber.preview([track(2)]);
  await flush();
  scrubber.stop();
  players[0].readyState = 0;
  scrubber.preview([track(4)]);
  scrubber.preview([track(6)]);
  players[0].readyState = 2;
  players[0].emit('loadedmetadata');
  await flush();
  assert.equal(players[0].calls.at(-1).time, 6);
  await advance(180);
  assert.equal(players[0].paused, true);
  scrubber.preview([track(7)]);
  players[0].error = { message: 'Unsupported codec' };
  players[0].emit('error');
  await flush();
  assert.equal(players[0].paused, true);
  assert.match(errors[0], /Unsupported codec/);
  scrubber.dispose();
  assert.equal(players[0].src, '');
});

test('renderer scrubbing mixes the active cut at its source offset and honors workspace, mute and export settings', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const requests = [];
  let stops = 0;
  let resumes = 0;
  const sandbox = {
    state: { scrubAudioEnabled: true, music: { url: 'music.wav' }, musicAudioEnabled: true,
      musicVolume: 0.3, clipAudioEnabled: true, workspace: 'editing', analysisTime: 4,
      edit: [{ start: 2, end: 5, sourceStart: 10, sourceId: 'source' }] },
    activeExport: null, resumeAfterScrub: false,
    musicPlayer: { currentTime: 3, paused: false, pause() { this.paused = true; } },
    activePreviewVideo: { paused: true, volume: 0.65 },
    audioScrubber: { preview: (tracks) => requests.push(tracks), stop: () => stops++ },
    sourceAnalysisMode: () => sandbox.state.workspace === 'color',
    getVideo: () => ({ url: 'source.mp4' }), pausePreviewPlayers() {},
    togglePlayback: () => resumes++
  };
  vm.createContext(sandbox);
  vm.runInContext(app.slice(app.indexOf('  function beginAudioScrub()'), app.indexOf('  function updateDuration()')), sandbox);
  sandbox.beginAudioScrub();
  assert.equal(sandbox.musicPlayer.paused, true);
  sandbox.previewScrubAudio();
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), [
    { key: 'music', url: 'music.wav', time: 3, volume: 0.3 },
    { key: 'source', url: 'source.mp4', time: 11, end: 13, volume: 0.65 }
  ]);
  sandbox.endAudioScrub();
  assert.equal(resumes, 1);
  sandbox.state.workspace = 'color';
  sandbox.previewScrubAudio();
  assert.equal(requests.at(-1).length, 1);
  assert.equal(requests.at(-1)[0].time, 4);
  sandbox.state.clipAudioEnabled = false;
  sandbox.previewScrubAudio();
  assert.equal(requests.at(-1).length, 0);
  sandbox.state.scrubAudioEnabled = false;
  sandbox.musicPlayer.paused = false;
  sandbox.beginAudioScrub();
  assert.equal(sandbox.musicPlayer.paused, false);
  sandbox.previewScrubAudio();
  sandbox.state.scrubAudioEnabled = true;
  sandbox.activeExport = {};
  sandbox.previewScrubAudio();
  assert.equal(requests.length, 3);
  assert.ok(stops >= 3);
});
