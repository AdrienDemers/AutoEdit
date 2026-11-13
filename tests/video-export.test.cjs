const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const exportCode = app.slice(app.indexOf('  function waitForExportMedia('), app.indexOf('  function escapeHtml('));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ failSeek = false, failDraw = false } = {}) {
  const frames = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  const events = [];
  const gains = [];
  const videos = [];
  let nextId = 0;
  let recorder;
  let music;
  class Media extends EventTarget {
    constructor() {
      super();
      this.readyState = 1;
      this.seeking = false;
      this.paused = true;
      this.currentTime = 0;
      this.seekable = { length: 0 };
      this.videoWidth = 1920;
      this.videoHeight = 1080;
    }
    set currentTime(value) {
      this.position = value;
      this.seeking = true;
      this.readyState = 1;
    }
    get currentTime() { return this.position; }
    completeSeek() {
      this.seeking = false;
      this.readyState = 2;
      this.dispatchEvent(new Event('seeked'));
    }
    async play() { this.paused = false; events.push('play'); }
    pause() { this.paused = true; }
    removeAttribute() {}
    load() { this.released = true; }
  }
  class Recorder extends EventTarget {
    static isTypeSupported() { return true; }
    constructor() { super(); recorder = this; this.state = 'inactive'; }
    start() { this.state = 'recording'; events.push('start'); }
    pause() { this.state = 'paused'; events.push('pause'); }
    resume() { this.state = 'recording'; events.push('resume'); }
    stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
  }
  const nodes = new Map();
  const sandbox = {
    endAudioScrub() {},
    AbortController, console: { error() {}, warn() {} },
    setTimeout: (callback, delay) => { const id = ++nextId; timeouts.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (callback) => { const id = ++nextId; intervals.set(id, callback); return id; },
    clearInterval: (id) => intervals.delete(id),
    requestAnimationFrame: (callback) => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
    MediaRecorder: Recorder,
    Audio: class extends Media { constructor() { super(); music = this; } },
    window: { AudioContext: class {
      constructor() { this.currentTime = 0; this.state = 'running'; }
      createMediaStreamDestination() { return { stream: { getAudioTracks: () => [] } }; }
      createMediaElementSource() { return { connect: (gain) => gain }; }
      createGain() {
        const node = { gain: { setValueAtTime() {} }, connect() {} };
        gains.push(node);
        return node;
      }
      async resume() {}
      async close() { this.state = 'closed'; }
    } },
    document: { createElement: (tag) => {
      if (tag === 'video') {
        const video = new Media();
        if (failSeek) video.error = { code: 3 };
        videos.push(video);
        return video;
      }
      return {
        captureStream: () => { events.push('capture'); return { addTrack() {}, getTracks: () => [] }; },
        getContext: () => ({
          fillRect() {},
          drawImage() {
            if (failDraw) throw new Error('Drawing failed');
            events.push('draw');
          }
        })
      };
    } },
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, { classList: { add() {}, remove() {} } });
      return nodes.get(id);
    },
    state: {
      music: { url: 'music' }, musicAudioEnabled: true, clipAudioEnabled: true, musicVolume: 0.8,
      edit: [
        { start: 0, end: 1, sourceId: 'video', sourceStart: 105.9 },
        { start: 1, end: 2, sourceId: 'video', sourceStart: 200 }
      ]
    },
    activeExport: null,
    desktopApi: {
      beginVideoExport: async () => 'output.mp4',
      writeVideoExport: async () => {},
      finishVideoExport: async () => events.push('finish'),
      cancelVideoExport: async () => events.push('cancel')
    },
    getVideo: () => ({ file: { name: 'camera.mp4' }, url: 'source', duration: 300 }),
    duration: () => 2,
    showNotice: (_id, message) => events.push(message),
    renderFootageAnalysis() {},
    colors: { render: (context, source, _settings, ...coordinates) => context.drawImage(source, ...coordinates) },
    formatSourceTime: String,
    formatTime: String
  };
  vm.createContext(sandbox);
  vm.runInContext(exportCode, sandbox);
  return {
    sandbox, videos, events, frames, intervals, timeouts, gains, nodes,
    get music() { return music; },
    get recorder() { return recorder; },
    async frame() {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback();
      await flush();
    },
    async cancel() {
      sandbox.activeExport.cancelled = true;
      sandbox.activeExport.controller.abort();
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      await flush();
    }
  };
}

test('export applies the source grade consistently across multiple clips from that source', async () => {
  const h = harness();
  const settings = { exposure: 1 };
  const grades = [];
  h.sandbox.getVideo = () => ({ file: { name: 'camera.mp4' }, url: 'source', duration: 300, color: settings });
  h.sandbox.colors.render = (context, source, color, ...coordinates) => { grades.push(color); context.drawImage(source, ...coordinates); };
  const result = h.sandbox.exportVideo();
  await flush();
  await h.frame();
  h.videos[0].completeSeek();
  await flush();
  h.music.position = 1;
  await h.frame();
  h.videos[0].completeSeek();
  await flush();
  h.music.position = 2;
  await h.frame();
  await result;
  assert.equal(grades.length, 2);
  assert.ok(grades.every((grade) => grade === settings));
  assert.ok(h.events.includes('finish'));
});

for (const enabled of [true, false]) {
  test(`export uses selected music volume and respects mute (${enabled})`, async () => {
    const h = harness();
    h.sandbox.state.musicVolume = 0.23;
    h.sandbox.state.musicAudioEnabled = enabled;
    const result = h.sandbox.exportVideo();
    await flush();
    assert.equal(h.gains[0].gain.value, enabled ? 0.23 : 0);
    assert.equal(h.music.volume, 1);
    assert.equal(h.nodes.get('musicVolume').disabled, true);
    await h.cancel();
    await h.frame();
    await result;
    assert.equal(h.nodes.get('musicVolume').disabled, false);
  });
}

for (const differentSource of [false, true]) {
  test(`export seeks before loadeddata and freezes capture (${differentSource ? 'different sources' : 'same source'})`, async () => {
    const h = harness();
    if (differentSource) h.sandbox.state.edit[1].sourceId = 'other-video';
    const result = h.sandbox.exportVideo();
    await flush();
    await h.frame();
    const player = h.videos[0];
    assert.equal(player.currentTime, 105.9);
    assert.equal(h.music.paused, true);
    assert.equal(h.recorder, undefined);
    assert.equal(h.frames.size, 0);
    player.completeSeek();
    await flush();
    assert.equal(h.recorder.state, 'recording');
    assert.equal(h.music.paused, false);
    assert.ok(h.events.indexOf('draw') < h.events.indexOf('start'));
    assert.ok(h.events.indexOf('draw') < h.events.indexOf('capture'));
    h.music.position = 1;
    await h.frame();
    const nextPlayer = differentSource ? h.videos[1] : player;
    assert.equal(nextPlayer.currentTime, 200);
    assert.equal(h.recorder.state, 'paused');
    assert.equal(h.music.paused, true);
    assert.equal(h.frames.size, 0);
    // A slow drive can become ready without emitting another loadeddata or seeked event.
    nextPlayer.seeking = false;
    nextPlayer.readyState = 2;
    for (const callback of [...h.intervals.values()]) callback();
    await flush();
    assert.equal(h.recorder.state, 'recording');
    assert.equal(h.music.paused, false);
    h.music.position = 2;
    await h.frame();
    await result;
    assert.ok(h.events.includes('finish'));
    assert.equal(player.released, true);
    assert.equal(h.intervals.size + h.timeouts.size + h.frames.size, 0);
  });
}

test('cancellation before recording starts does not leave export waiting for a stop event', async () => {
  const h = harness();
  const result = h.sandbox.exportVideo();
  await flush();
  await h.cancel();
  await h.frame();
  await result;
  assert.ok(h.events.includes('cancel'));
  assert.ok(!h.events.includes('start'));
  assert.equal(h.videos[0].released, true);
});

for (const stage of ['first', 'second']) {
  test(`cancellation during the ${stage} seek releases media and cancels output`, async () => {
    const h = harness();
    const result = h.sandbox.exportVideo();
    await flush();
    await h.frame();
    if (stage === 'second') {
      h.videos[0].completeSeek();
      await flush();
      h.music.position = 1;
      await h.frame();
    }
    await h.cancel();
    await result;
    assert.ok(h.events.includes('cancel'));
    assert.ok(!h.events.includes('finish'));
    assert.equal(h.videos[0].released, true);
    assert.equal(h.intervals.size + h.timeouts.size + h.frames.size, 0);
  });
}

for (const failure of ['decode', 'timeout', 'draw']) {
  test(`${failure} failure reports an error and removes incomplete output`, async () => {
    const h = harness({ failSeek: failure === 'decode', failDraw: failure === 'draw' });
    const result = h.sandbox.exportVideo();
    await flush();
    await h.frame();
    if (failure === 'draw') h.videos[0].completeSeek();
    if (failure === 'timeout') {
      const timeout = [...h.timeouts.values()].find(({ delay }) => delay === 90000);
      assert.ok(timeout);
      timeout.callback();
    }
    await result;
    assert.ok(h.events.some((event) => event.startsWith('Video export failed')));
    assert.ok(h.events.includes('cancel'));
    assert.ok(!h.events.includes('finish'));
    assert.equal(h.videos[0].released, true);
    assert.equal(h.intervals.size + h.timeouts.size + h.frames.size, 0);
  });
}
