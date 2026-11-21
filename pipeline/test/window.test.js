'use strict';
/** v0.2 pure logic: reporter window (F-04) and adaptive delete cap (F-03). */

const test = require('node:test');
const assert = require('node:assert');

const {
  WINDOW_DAYS, WINDOW_SECONDS, windowAdd, windowPrune, adaptiveCap, runsRemainingToday,
} = require('../src/window');
const { MODEL, quotaBudget } = require('../src/quota');

const DAY = 86_400;

test('window: constants match the 90-day plan retention (P-16)', () => {
  assert.equal(WINDOW_DAYS, 90);
  assert.equal(WINDOW_SECONDS, 90 * DAY);
});

test('window: add slides to the most recent report (D-V1)', () => {
  let v = windowAdd({}, 'u1', 1_000);
  assert.deepEqual(v, { u1: 1_000 });
  v = windowAdd(v, 'u1', 2_000); // re-report slides forward
  assert.deepEqual(v, { u1: 2_000 });
  v = windowAdd(v, 'u1', 500); // an older timestamp never regresses the entry
  assert.deepEqual(v, { u1: 2_000 });
  v = windowAdd(v, 'u2', 1_500);
  assert.deepEqual(v, { u1: 2_000, u2: 1_500 });
  // input not mutated
  assert.deepEqual(windowAdd({}, 'u1', 1), { u1: 1 });
});

test('window: prune drops entries at or beyond 90 days (F-04)', () => {
  const now = 1_800_000_000;
  const v = { a: now - WINDOW_SECONDS, b: now - WINDOW_SECONDS + 1, c: now - 30 * DAY };
  const res = windowPrune(v, now);
  assert.deepEqual(res.ventana, { b: now - WINDOW_SECONDS + 1, c: now - 30 * DAY });
  assert.equal(res.dropped, 1);
  assert.equal(res.reportantes, 2);
});

test('window: prune boundary mirrors report expiry semantics', () => {
  const now = 2_000_000_000;
  // expira_en = creado_en + 90d is deleted when expira_en < now, so an
  // entry whose window ends exactly now is dropped too.
  const res = windowPrune({ a: now - WINDOW_SECONDS }, now);
  assert.equal(res.dropped, 1);
  assert.equal(res.reportantes, 0);
  const kept = windowPrune({ a: now - WINDOW_SECONDS + 1 }, now);
  assert.equal(kept.dropped, 0);
});

test('adaptive cap: spread the backlog over the remaining runs (D-F3)', () => {
  // 5000 pending, 3 runs left -> 1667 per run (below the prudent cap)
  assert.equal(adaptiveCap({ pending: 5000, runsRemainingToday: 3 }), 1667);
  // remaining backlog, 2 runs left -> 1667
  assert.equal(adaptiveCap({ pending: 3333, runsRemainingToday: 2 }), 1667);
  // small backlog: never below one batch
  assert.equal(adaptiveCap({ pending: 10, runsRemainingToday: 3 }), MODEL.batchSize);
  // burst above the prudent cap: capped, absorbed across runs
  assert.equal(adaptiveCap({ pending: 100_000, runsRemainingToday: 4 }), MODEL.prudentCapPerRun);
  // nothing pending: no budget
  assert.equal(adaptiveCap({ pending: 0, runsRemainingToday: 4 }), 0);
  // no runs left: fail open at the prudent cap, never stall the queue
  assert.equal(adaptiveCap({ pending: 100, runsRemainingToday: 0 }), MODEL.prudentCapPerRun);
});

test('adaptive cap: total capacity across runs covers the backlog', () => {
  const pending = 7_200;
  let left = pending;
  let runs = 4;
  while (left > 0 && runs > 0) {
    const cap = adaptiveCap({ pending: left, runsRemainingToday: runs });
    left -= Math.min(cap, left);
    runs -= 1;
  }
  assert.equal(left, 0, 'backlog must drain within the day runs');
  assert.ok(runs >= 0);
});

test('runsRemainingToday: deterministic slots', () => {
  const midnight = 20_000 * DAY; // exactly divisible
  assert.equal(runsRemainingToday(midnight), 3); // slot 0 in progress
  assert.equal(runsRemainingToday(midnight + 1), 3);
  assert.equal(runsRemainingToday(midnight + DAY - 1), 0); // last slot
  assert.equal(runsRemainingToday(midnight + (DAY / 4) * 3 - 1), 1);
});

test('quota budget: v0.2 model (prune pass + cleanup status) stays within Spark', () => {
  for (const volume of [1_000, 10_000]) {
    const b = quotaBudget(volume);
    assert.equal(b.ok, true, JSON.stringify(b));
    assert.ok(b.reads > 0 && b.writes > 0);
  }
});
