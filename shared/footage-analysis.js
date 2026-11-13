(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AutoEditFootage = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  const eventThreshold = 0.5;
  const preferenceCache = new WeakMap();
  const clamp = (value) => Math.min(1, Math.max(0, value));
  const speechLabels = new Set([
    'Speech', 'Male speech, man speaking', 'Female speech, woman speaking',
    'Child speech, kid speaking', 'Conversation', 'Narration, monologue', 'Whispering'
  ]);

  function audioEvents(logits, labels) {
    let speech = 0;
    let clapping = 0;
    for (let index = 0; index < logits.length; index++) {
      if (!Number.isFinite(logits[index])) throw new Error('The audio model returned invalid scores.');
      // AudioSet is multi-label: speech and applause can occur simultaneously.
      const score = 1 / (1 + Math.exp(-logits[index]));
      if (speechLabels.has(labels[index])) speech = Math.max(speech, score);
      if (labels[index] === 'Clapping' || labels[index] === 'Applause') clapping = Math.max(clapping, score);
    }
    return { speech, clapping };
  }

  function frameMotion(previous, current) {
    if (!previous || previous.length !== current.length || !current.length) return 0;
    let brightnessChange = 0;
    for (let index = 0; index < current.length; index++) brightnessChange += current[index] - previous[index];
    brightnessChange /= current.length;
    let difference = 0;
    for (let index = 0; index < current.length; index++) {
      difference += Math.abs(current[index] - previous[index] - brightnessChange);
    }
    return clamp(difference / current.length / 255);
  }

  function validAnalysis(value) {
    if (!value || value.version !== 1 || !Number.isFinite(value.duration) || value.duration <= 0
      || !Number.isFinite(value.fingerprint?.size) || !Number.isFinite(value.fingerprint?.mtimeMs)
      || !['available', 'none'].includes(value.audioStatus)) return false;
    const validRanges = (ranges, keys) => {
      if (!Array.isArray(ranges) || ranges.length > 100000) return false;
      let lastEnd = 0;
      return ranges.every((range) => {
        if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)
          || range.start < lastEnd || range.end <= range.start || range.end > value.duration + 0.01
          || !keys.every((key) => Number.isFinite(range[key]) && range[key] >= 0 && range[key] <= 1)) return false;
        lastEnd = range.end;
        return true;
      });
    };
    return validRanges(value.motion, ['score']) && value.motion.length > 0
      && validRanges(value.audio, ['speech', 'clapping'])
      && (value.audioStatus === 'none' ? value.audio.length === 0 : value.audio.length > 0);
  }

  function sameFingerprint(left, right) {
    return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
  }

  function validEdits(value, duration) {
    if (!value || value.version !== 1 || !Number.isFinite(duration) || duration <= 0
      || Object.keys(value).some((key) => !['version', 'speech', 'clapping', 'motion'].includes(key))) return false;
    return ['speech', 'clapping', 'motion'].every((kind) => {
      if (!(kind in value)) return true;
      if (!Array.isArray(value[kind]) || value[kind].length > 100000) return false;
      let lastEnd = 0;
      return value[kind].every((range) => {
        if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)
          || range.start < lastEnd || range.end <= range.start || range.end > duration
          || !Number.isFinite(range.score) || range.score < 0 || range.score > 1) return false;
        lastEnd = range.end;
        return true;
      });
    });
  }

  function editableRanges(video, kind, motionScale) {
    if (!['speech', 'clapping', 'motion'].includes(kind)) throw new Error('Unknown footage range type.');
    if (video.analysisEdits?.[kind]) return video.analysisEdits[kind];
    if (!video.analysis) return [];
    if (kind === 'motion') return eventRanges(video.analysis.motion.map((range) => ({
      ...range, score: clamp(range.score / motionScale)
    })), 'score');
    return eventRanges(video.analysis.audio, kind);
  }

  function editRanges(ranges, index, replacement, duration) {
    if (index !== null && (!Number.isInteger(index) || index < 0 || index >= ranges.length)) {
      throw new Error('Select an existing range to edit.');
    }
    const result = ranges.filter((_range, position) => position !== index);
    if (replacement) result.push({ ...replacement });
    result.sort((left, right) => left.start - right.start);
    if (!validEdits({ version: 1, speech: result }, duration)) {
      throw new Error('Ranges must stay within the source, have an end after the start, and not overlap another range of the same type.');
    }
    return result;
  }

  function percentile(values, fraction) {
    const sorted = [...values].sort((left, right) => left - right);
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
  }

  function musicEnergy(buffer) {
    const windows = [];
    const frames = Math.max(1, Math.round(buffer.sampleRate * 2));
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    for (let start = 0; start < buffer.length; start += frames) {
      const end = Math.min(buffer.length, start + frames);
      let sum = 0;
      for (const channel of channels) {
        for (let index = start; index < end; index++) sum += channel[index] * channel[index];
      }
      windows.push({ start: start / buffer.sampleRate, end: end / buffer.sampleRate,
        score: Math.sqrt(sum / ((end - start) * channels.length)) });
    }
    const low = percentile(windows.map((range) => range.score), 0.1);
    const high = percentile(windows.map((range) => range.score), 0.9);
    return windows.map((range) => ({
      ...range, score: high > low + 0.00001 ? clamp((range.score - low) / (high - low)) : (high > 0.00001 ? 0.5 : 0)
    }));
  }

  function average(ranges, start, end, key) {
    let total = 0;
    let low = 0;
    let high = ranges.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (ranges[middle].end <= start) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < ranges.length; index++) {
      const range = ranges[index];
      if (range.start >= end) break;
      const overlap = Math.max(0, Math.min(end, range.end) - Math.max(start, range.start));
      total += overlap * range[key];
    }
    return end > start ? total / (end - start) : 0;
  }

  function eventRanges(audio, key) {
    const result = [];
    for (const range of audio) {
      if (range[key] < eventThreshold) continue;
      const previous = result[result.length - 1];
      if (previous && Math.abs(previous.end - range.start) < 0.01) {
        previous.end = range.end;
        previous.score = Math.max(previous.score, range[key]);
      } else result.push({ start: range.start, end: range.end, score: range[key] });
    }
    return result;
  }

  function rangeScore(video, start, length, energy, motionScale) {
    const end = start + length;
    const edits = video.analysisEdits || {};
    const motion = clamp(average(edits.motion || video.analysis.motion, start, end, 'score') / (edits.motion ? 1 : motionScale));
    const speech = average(edits.speech || video.analysis.audio, start, end, edits.speech ? 'score' : 'speech');
    const clapping = average(edits.clapping || video.analysis.audio, start, end, edits.clapping ? 'score' : 'clapping');
    const motionMatch = 1 - Math.abs(motion - energy);
    return motionMatch + (energy >= 0.6 && clapping >= eventThreshold ? 0.75 * clapping : 0)
      + (energy <= 0.4 && speech >= eventThreshold ? 1.5 * speech : 0);
  }

  function bestRange(video, length, energy, minStart, maxStart, fallback, motionScale) {
    if (!video.analysis) return { start: fallback, score: 1 };
    const starts = [Math.max(minStart, Math.min(maxStart, fallback)), minStart, maxStart];
    for (const range of [...video.analysis.motion, ...video.analysis.audio]) {
      if (range.start >= minStart && range.start <= maxStart) starts.push(range.start);
    }
    for (const ranges of Object.values(video.analysisEdits || {}).filter(Array.isArray)) {
      for (const range of ranges) {
        if (range.start >= minStart && range.start <= maxStart) starts.push(range.start);
        const endingStart = range.end - length;
        if (endingStart >= minStart && endingStart <= maxStart) starts.push(endingStart);
      }
    }
    let best = { start: starts[0], score: -Infinity };
    for (const start of starts) {
      const score = rangeScore(video, start, length, energy, motionScale);
      if (score > best.score) best = { start, score };
    }
    return best;
  }

  function guideSourceStarts(cuts, videos, energy) {
    const analyzed = videos.filter((video) => video.analysis);
    const motionScale = Math.max(0.005, percentile(analyzed.flatMap((video) => video.analysis.motion.map((range) => range.score)), 0.9));
    for (const video of analyzed) {
      const sourceCuts = cuts.filter((cut) => cut.sourceId === video.id);
      const originalStarts = sourceCuts.map((cut) => cut.sourceStart);
      let previousStart = 0;
      let remainingUse = sourceCuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
      const canAvoidOverlap = remainingUse < video.duration;
      const longestRemaining = sourceCuts.map((cut) => cut.end - cut.start);
      for (let index = longestRemaining.length - 2; index >= 0; index--) {
        longestRemaining[index] = Math.max(longestRemaining[index], longestRemaining[index + 1]);
      }
      sourceCuts.forEach((cut, index) => {
        const length = cut.end - cut.start;
        const lastValidStart = video.duration - (canAvoidOverlap ? remainingUse : longestRemaining[index]);
        const maxStart = Math.min(lastValidStart, Math.max(previousStart, originalStarts[index + 1] ?? lastValidStart));
        const minStart = Math.min(maxStart, previousStart);
        const musicLevel = average(energy, cut.start, cut.end, 'score');
        const selected = bestRange(video, length, musicLevel, minStart, maxStart, originalStarts[index], motionScale);
        cut.sourceStart = selected.start;
        previousStart = selected.start + (canAvoidOverlap ? length : 0);
        remainingUse -= length;
      });
    }
  }

  function sourcePreference(video, cut, energy, motionScale) {
    if (!video.analysis) return 1;
    const length = cut.end - cut.start;
    const level = average(energy, cut.start, cut.end, 'score');
    let cache = preferenceCache.get(video);
    if (!cache || cache.analysis !== video.analysis || cache.edits !== video.analysisEdits) {
      cache = { analysis: video.analysis, edits: video.analysisEdits, values: new Map() };
      preferenceCache.set(video, cache);
    }
    const key = `${video.duration}/${length.toFixed(6)}/${level.toFixed(6)}/${motionScale}`;
    if (!cache.values.has(key)) {
      cache.values.set(key, 0.25 + bestRange(video, length, level, 0, video.duration - length, 0, motionScale).score);
    }
    return cache.values.get(key);
  }

  return { eventThreshold, audioEvents, frameMotion, validAnalysis, sameFingerprint, musicEnergy,
    eventRanges, average, percentile, guideSourceStarts, sourcePreference, validEdits, editableRanges, editRanges };
});
