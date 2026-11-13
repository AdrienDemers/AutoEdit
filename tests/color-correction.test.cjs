const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const color = require(path.join(__dirname, '..', 'shared', 'color-correction.js'));

test('source grading rejects malformed saved controls and accepts neutral and bounded adjustments', () => {
  assert.equal(color.valid(color.defaults), true);
  assert.equal(color.adjusted(color.defaults), false);
  assert.equal(color.adjusted({ ...color.defaults, exposure: 1 }), true);
  assert.equal(color.valid({ ...color.defaults, saturation: 201 }), false);
  assert.equal(color.valid({ ...color.defaults, exposure: NaN }), false);
  assert.equal(color.valid({ exposure: 1 }), false);
  assert.equal(color.valid({ ...color.defaults, unknown: 1 }), false);
});

test('neutral sources preserve the original draw path without requiring a GPU; invalid grading fails explicitly', () => {
  const source = {};
  const calls = [];
  const context = { drawImage: (...args) => calls.push(args) };
  color.render(context, source, null, 2, 3, 100, 50);
  color.render(context, source, color.defaults, 2, 3, 100, 50);
  assert.deepEqual(calls, [[source, 2, 3, 100, 50], [source, 2, 3, 100, 50]]);
  assert.throws(() => color.render(context, source, { exposure: 10 }, 0, 0, 1, 1), /Invalid source color/);
});
