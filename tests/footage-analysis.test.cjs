const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const vm = require('node:vm');
const footage = require('../shared/footage-analysis.js');
const { registerFootageAnalysis } = require('../electron/footage-analysis.cjs');
const run = promisify(execFile);

function analysis({ duration = 20, motion = [], audio = [] } = {}) {
  return { version: 1, fingerprint: { size: 10, mtimeMs: 123 }, duration, motion, audio,
    audioStatus: audio.length ? 'available' : 'none' };
}
const music = [
  { start: 0, end: 4, score: 1 },
  { start: 4, end: 8, score: 0 }
];

test('audio event scores allow simultaneous speech and clapping, without treating music as speech', () => {
  const result = footage.audioEvents([2, 1, 8], { 0: 'Speech', 1: 'Clapping', 2: 'Music' });
  assert.ok(result.speech > 0.85);
  assert.ok(result.clapping > 0.7);
  const singing = footage.audioEvents([8, -10, -10], { 0: 'Singing', 1: 'Speech', 2: 'Applause' });
  assert.ok(singing.speech < footage.eventThreshold);
  assert.ok(singing.clapping < footage.eventThreshold);
  assert.throws(() => footage.audioEvents([NaN], { 0: 'Speech' }), /invalid scores/);
});

test('motion scoring distinguishes movement from static frames and uniform lighting changes', () => {
  assert.equal(footage.frameMotion(Uint8Array.from([10, 20, 30]), Uint8Array.from([10, 20, 30])), 0);
  assert.equal(footage.frameMotion(Uint8Array.from([10, 20, 30]), Uint8Array.from([50, 60, 70])), 0);
  assert.ok(footage.frameMotion(Uint8Array.from([0, 255]), Uint8Array.from([255, 0])) > 0.9);
});

test('energy measures both channels and handles constant-energy and silent songs', () => {
  const buffer = {
    sampleRate: 2, length: 8, numberOfChannels: 2,
    getChannelData: (channel) => Float32Array.from(channel ? [-0.1, -0.1, -0.1, -0.1, -0.9, -0.9, -0.9, -0.9]
      : [0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9])
  };
  const energy = footage.musicEnergy(buffer);
  assert.equal(energy[0].score, 0);
  assert.equal(energy[1].score, 1);
  assert.equal(footage.musicEnergy({ ...buffer, getChannelData: () => new Float32Array(8) })[0].score, 0);
  assert.equal(footage.musicEnergy({ ...buffer, getChannelData: () => new Float32Array(8).fill(0.2) })[0].score, 0.5);
});

test('event ranges merge adjacent detections but do not bridge silence', () => {
  assert.deepEqual(footage.eventRanges([
    { start: 0, end: 5, speech: 0.8 }, { start: 5, end: 10, speech: 0.9 },
    { start: 10, end: 15, speech: 0.1 }, { start: 15, end: 20, speech: 0.7 }
  ], 'speech'), [{ start: 0, end: 10, score: 0.9 }, { start: 15, end: 20, score: 0.7 }]);
});

test('guided source ranges prefer high motion during loud music and speech during quiet music', () => {
  const video = {
    id: 'camera', duration: 20,
    analysis: analysis({
      motion: [{ start: 0, end: 4, score: 0 }, { start: 4, end: 8, score: 0.2 }, { start: 8, end: 20, score: 0 }],
      audio: [{ start: 0, end: 12, speech: 0, clapping: 0 }, { start: 12, end: 16, speech: 0.9, clapping: 0 },
        { start: 16, end: 20, speech: 0, clapping: 0 }]
    })
  };
  const cuts = [
    { start: 0, end: 4, sourceId: 'camera', sourceStart: 2 },
    { start: 4, end: 8, sourceId: 'camera', sourceStart: 10 }
  ];
  footage.guideSourceStarts(cuts, [video], music);
  assert.equal(cuts[0].sourceStart, 4);
  assert.equal(cuts[1].sourceStart, 12);
  assert.ok(cuts[1].sourceStart >= cuts[0].sourceStart + 4);
});

test('source selection favors clapping for energetic music and speech for quiet music', () => {
  const makeVideo = (speech, clapping) => ({
    id: 'video', duration: 20,
    analysis: analysis({ motion: [{ start: 0, end: 20, score: 0.1 }],
      audio: [{ start: 0, end: 20, speech, clapping }] })
  });
  const plain = makeVideo(0, 0);
  assert.ok(footage.sourcePreference(makeVideo(0, 0.9), { start: 0, end: 4 }, music, 0.1)
    > footage.sourcePreference(plain, { start: 0, end: 4 }, music, 0.1));
  assert.ok(footage.sourcePreference(makeVideo(0.9, 0), { start: 4, end: 8 }, music, 0.1)
    > footage.sourcePreference(plain, { start: 4, end: 8 }, music, 0.1));
});

test('guided ranges stay chronological and within source bounds even when footage must be reused', () => {
  for (const sourceDuration of [10, 30]) {
    const video = { id: 'camera', duration: sourceDuration, analysis: analysis({ duration: sourceDuration,
      motion: [{ start: 0, end: sourceDuration, score: 0.1 }] }) };
    const cuts = [4, 2, 6, 3].map((length, index) => ({
      start: index * 6, end: index * 6 + length, sourceId: 'camera', sourceStart: index
    }));
    footage.guideSourceStarts(cuts, [video], [{ start: 0, end: 30, score: 1 }]);
    cuts.forEach((cut, index) => {
      assert.ok(cut.sourceStart >= 0 && cut.sourceStart + cut.end - cut.start <= sourceDuration + 0.001);
      if (index) assert.ok(cut.sourceStart >= cuts[index - 1].sourceStart);
      if (index && sourceDuration === 30) assert.ok(cut.sourceStart >= cuts[index - 1].sourceStart + cuts[index - 1].end - cuts[index - 1].start);
    });
  }
});

test('unanalyzed footage keeps existing in-points and malformed cache ranges are rejected', () => {
  const cuts = [{ start: 0, end: 4, sourceId: 'camera', sourceStart: 7 }];
  footage.guideSourceStarts(cuts, [{ id: 'camera', duration: 20 }], music);
  assert.equal(cuts[0].sourceStart, 7);
  assert.equal(footage.validAnalysis(analysis({ motion: [{ start: 0, end: 20, score: NaN }] })), false);
  assert.equal(footage.validAnalysis(analysis({ motion: [{ start: 0, end: 21, score: 0.2 }] })), false);
  assert.equal(footage.validAnalysis(analysis({ motion: [{ start: 0, end: 5, score: 0.2 }, { start: 4, end: 8, score: 0.2 }] })), false);
});

test('footage ranges can be resized, added and removed without mutating detections or accepting overlaps', () => {
  const detected = [{ start: 2, end: 4, score: 0.9 }, { start: 6, end: 9, score: 0.8 }];
  const resized = footage.editRanges(detected, 0, { start: 1, end: 5, score: 0.9 }, 10);
  assert.deepEqual(detected[0], { start: 2, end: 4, score: 0.9 });
  assert.deepEqual(resized[0], { start: 1, end: 5, score: 0.9 });
  assert.throws(() => footage.editRanges(detected, 0, { start: 3, end: 7, score: 1 }, 10), /overlap/);
  assert.throws(() => footage.editRanges(detected, null, { start: 9, end: 11, score: 1 }, 10), /within/);
  const removed = footage.editRanges(detected, 0, null, 10);
  assert.deepEqual(footage.editRanges(removed, null, { start: 0, end: 2, score: 1 }, 10),
    [{ start: 0, end: 2, score: 1 }, { start: 6, end: 9, score: 0.8 }]);
});

test('manual speech ranges replace only speech, invalidate scoring caches and count unmarked gaps as zero', () => {
  const video = { id: 'camera', duration: 20, analysis: analysis({
    motion: [{ start: 0, end: 20, score: 0 }],
    audio: [{ start: 0, end: 20, speech: 0.9, clapping: 0.8 }]
  }) };
  const cut = { start: 4, end: 8 };
  const detectedScore = footage.sourcePreference(video, cut, music, 0.005);
  video.analysisEdits = { version: 1, speech: [] };
  const removedScore = footage.sourcePreference(video, cut, music, 0.005);
  assert.ok(detectedScore > removedScore);
  assert.deepEqual(footage.editableRanges(video, 'speech', 0.005), []);
  assert.equal(footage.editableRanges(video, 'clapping', 0.005).length, 1);
  video.analysisEdits = { version: 1, speech: [{ start: 2, end: 4, score: 1 }] };
  assert.equal(footage.average(video.analysisEdits.speech, 0, 4, 'score'), 0.5);
  assert.ok(footage.sourcePreference(video, cut, music, 0.005) > removedScore);
  const saved = JSON.parse(JSON.stringify(video.analysisEdits));
  assert.ok(footage.validEdits(saved, video.duration));
  video.analysisEdits = null;
  assert.equal(footage.sourcePreference(video, cut, music, 0.005), detectedScore);
  assert.equal(video.analysis.audio[0].speech, 0.9);
});

test('manual motion levels use normalized intensity rather than changing the project motion scale', () => {
  const video = { id: 'camera', duration: 20, analysis: analysis({ motion: [{ start: 0, end: 20, score: 0 }] }),
    analysisEdits: { version: 1, motion: [{ start: 0, end: 20, score: 0.7 }] } };
  for (const scale of [0.005, 0.2]) {
    assert.ok(Math.abs(footage.sourcePreference(video, { start: 0, end: 4 }, music, scale) - 0.95) < 0.0001);
  }
  assert.equal(video.analysis.motion[0].score, 0);
});

test('preview music volume is independent of mute and persisted with footage analysis', async () => {
  const app = await fs.readFile(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const nodes = new Map();
  const sandbox = {
    audioScrubber: { stop() {} },
    clipSlipPreview: {},
    musicPlayer: { currentTime: 0 }, updatePreviewPlayerAudio() {},
    $: (id) => {
      if (!nodes.has(id)) nodes.set(id, { value: '', textContent: 'test', setAttribute() {} });
      return nodes.get(id);
    },
    state: {
      music: null, videos: [{ id: 'camera', path: 'camera.mp4', file: { name: 'camera.mp4' }, analysis: { version: 1 } }],
      musicVolume: 0.25, musicAudioEnabled: false, clipAudioEnabled: true, useFootageAnalysis: true
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(app.slice(app.indexOf('  function updateAudioToggles('), app.indexOf('  function updatePlayButton(')), sandbox);
  vm.runInContext(app.slice(app.indexOf('  function sessionSnapshot('), app.indexOf('  function persistSession(')), sandbox);
  sandbox.updateAudioToggles();
  assert.equal(sandbox.musicPlayer.volume, 0.25);
  assert.equal(sandbox.musicPlayer.muted, true);
  assert.equal(sandbox.clipSlipPreview.muted, false);
  assert.equal(nodes.get('musicVolumeValue').textContent, '25%');
  sandbox.state.musicAudioEnabled = true;
  sandbox.updateAudioToggles();
  assert.equal(sandbox.musicPlayer.volume, 0.25);
  assert.equal(sandbox.musicPlayer.muted, false);
  sandbox.state.clipAudioEnabled = false;
  sandbox.updateAudioToggles();
  assert.equal(sandbox.clipSlipPreview.muted, true);
  const saved = sandbox.sessionSnapshot();
  assert.equal(saved.musicVolume, 0.25);
  assert.equal(saved.useFootageAnalysis, true);
  assert.equal(saved.videos[0].analysis.version, 1);
});

test('automatic assembly uses analyzed sources for energy matching and preserves the disabled fallback', async () => {
  const app = await fs.readFile(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const code = app.slice(app.indexOf('  function rebuildAutomaticEdit('), app.indexOf('  function setFrameIndicator('));
  const high = { id: 'high', duration: 20, importance: 1,
    analysis: analysis({ motion: [{ start: 0, end: 20, score: 0.2 }] }) };
  const talking = { id: 'talking', duration: 20, importance: 1,
    analysis: analysis({ motion: [{ start: 0, end: 20, score: 0 }],
      audio: [{ start: 0, end: 10, speech: 0, clapping: 0 }, { start: 10, end: 20, speech: 0.9, clapping: 0 }] }) };
  const assemble = (videos, enabled) => {
    const sandbox = {
      state: { videos, beatTimes: [1, 2, 3], musicEnergy: [{ start: 0, end: 2, score: 1 }, { start: 2, end: 4, score: 0 }],
        useFootageAnalysis: enabled },
      footage, duration: () => 4, $: () => ({ value: '1' }),
      clearSelectedClip() {},
      setExportAvailability() {}, renderVideoTrack() {}, showNotice() {}, drawWaveform() {}, syncPreview() {}, persistSession() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    sandbox.rebuildAutomaticEdit();
    return JSON.parse(JSON.stringify(sandbox.state.edit));
  };
  const guided = assemble([high, talking], true);
  assert.deepEqual(guided.map((cut) => cut.sourceId), ['high', 'high', 'talking', 'talking']);
  assert.equal(guided[0].start, 0);
  assert.equal(guided[3].end, 4);
  assert.ok(guided[2].sourceStart >= 10);
  assert.deepEqual(assemble([high, talking], false),
    assemble([{ ...high, analysis: null }, { ...talking, analysis: null }], true));
});

test('local worker decodes motion, handles silent video, reuses cache and rejects inaccessible inputs', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'autoedit-footage-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'motion.mp4');
  await run(require('ffmpeg-static'), ['-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=128x72:r=8:d=2',
    '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=8:duration=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', filePath]);
  const handlers = new Map();
  const app = new EventEmitter();
  app.getPath = () => directory;
  registerFootageAnalysis({
    app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    allowedPaths: () => new Set([filePath])
  });
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  const messages = [];
  sender.send = (_name, message) => messages.push(message);
  const event = { sender };
  assert.throws(() => handlers.get('footage:analyze')(event, { filePath: 'not-imported.mp4', duration: 4 }), /not part/);
  const result = await handlers.get('footage:analyze')(event, { filePath, duration: 4 });
  assert.ok(footage.validAnalysis(result));
  assert.equal(result.audioStatus, 'none');
  assert.equal(result.motion[0].score, 0);
  assert.ok(result.motion[1].score > 0.005);
  assert.deepEqual(await handlers.get('footage:fingerprint')(event, filePath), result.fingerprint);
  messages.length = 0;
  assert.deepEqual(await handlers.get('footage:analyze')(event, { filePath, duration: 4, cached: result }), result);
  assert.equal(messages.length, 0);
  const reanalyzed = await handlers.get('footage:analyze')(event, {
    filePath, duration: 4, cached: { ...result, fingerprint: { ...result.fingerprint, mtimeMs: 0 } }
  });
  assert.ok(messages.length > 0);
  assert.deepEqual(reanalyzed.motion, result.motion);
  const canceled = handlers.get('footage:analyze')(event, { filePath, duration: 4 });
  await handlers.get('footage:cancel')(event);
  await assert.rejects(canceled, /canceled/);
  assert.deepEqual(await handlers.get('footage:analyze')(event, { filePath, duration: 4, cached: result }), result);
  await fs.writeFile(filePath, 'not a video');
  await assert.rejects(handlers.get('footage:analyze')(event, { filePath, duration: 4 }), /decoding failed/);
  await fs.rm(filePath);
  await assert.rejects(handlers.get('footage:analyze')(event, { filePath, duration: 4 }), /ENOENT/);
});
