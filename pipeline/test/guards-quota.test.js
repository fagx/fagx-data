'use strict';
/** Shrink guard and quota budget tests (fictitious volumes). */

const test = require('node:test');
const assert = require('node:assert');

const { shrinkGuard } = require('../src/guards');
const { quotaBudget, MODEL, deleteCapacityPerDay, QUOTAS } = require('../src/quota');
const { checkPayload, listSize } = require('../src/payload');

test('shrink guard: exactly 50% is allowed, below fails', () => {
  assert.equal(shrinkGuard(100, 50).ok, true);
  assert.equal(shrinkGuard(100, 49).ok, false);
  assert.equal(shrinkGuard(100, 49).reason, 'E_SHRINK_GT_50PCT');
  assert.equal(shrinkGuard(100, 99).ok, true);
  assert.equal(shrinkGuard(100, 100).ok, true);
  assert.equal(shrinkGuard(100, 150).ok, true);
});

test('shrink guard: empty previous list never fails', () => {
  assert.equal(shrinkGuard(0, 0).ok, true);
  assert.equal(shrinkGuard(0, 500).ok, true);
});

test('shrink guard: intentional override (--allow-shrink) documents a supervised shrink', () => {
  const res = shrinkGuard(100, 20, { allowShrink: true });
  assert.equal(res.ok, true);
  assert.equal(res.ratio, 0.2);
});

test('shrink guard: bad counts fail closed', () => {
  assert.equal(shrinkGuard(-1, 5).ok, false);
  assert.equal(shrinkGuard(10, 1.5).ok, false);
  assert.equal(shrinkGuard('10', 5).ok, false);
});

test('quota budget: within budget at 1,000/day (fictitious)', () => {
  const b = quotaBudget(1_000);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.ok(b.reads <= QUOTAS.readsPerDay);
  assert.ok(b.writes <= QUOTAS.writesPerDay);
  assert.ok(b.deletes <= b.deleteCapacity);
});

test('quota budget: within budget at 10,000/day (fictitious)', () => {
  const b = quotaBudget(10_000);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.ok(b.deletes <= b.deleteCapacity);
});

test('quota budget: delete capacity stays under the Spark hard quota', () => {
  assert.equal(deleteCapacityPerDay(), MODEL.runsPerDay * MODEL.prudentCapPerRun);
  assert.ok(deleteCapacityPerDay() <= QUOTAS.deletesPerDay);
});

test('quota budget: alerts when pending expired exceeds the threshold', () => {
  const b = quotaBudget(1_000, { pendingExpired: MODEL.pendingAlertThreshold + 1 });
  assert.equal(b.ok, true); // budget fine; the alert is operational (runbook)
  assert.equal(b.alerts.length, 1);
  assert.match(b.alerts[0], /^ALERT_PENDING_EXPIRED:/);
});

test('payload semantic checks', () => {
  const inst = (n) => ({ numeros: n, rangos: [] });
  assert.equal(checkPayload({ schema_version: 1, secuencia: 1, generado_en: 0, institucional: inst([]), prefijos: ['600', '809'] }).ok, true);
  assert.equal(checkPayload({ schema_version: 2, secuencia: 1, generado_en: 0, institucional: inst([]), prefijos: [] }).ok, false);
  assert.equal(checkPayload({ schema_version: 1, secuencia: 0, generado_en: 0, institucional: inst([]), prefijos: [] }).ok, false);
  assert.equal(checkPayload({ schema_version: 1, secuencia: 1, generado_en: 0, institucional: inst([]), prefijos: ['999'] }).ok, false);
  // institucional entries: both forms, consistent
  assert.equal(checkPayload({ schema_version: 1, secuencia: 1, generado_en: 0, institucional: inst([{ numero: '6001234567', numero_e164: '566001234567' }]), prefijos: [] }).ok, true);
  // movil instead of 600+7
  assert.equal(checkPayload({ schema_version: 1, secuencia: 1, generado_en: 0, institucional: inst([{ numero: '56912345678', numero_e164: '5656912345678' }]), prefijos: [] }).ok, false);
  // e164 inconsistent with numero
  assert.equal(checkPayload({ schema_version: 1, secuencia: 1, generado_en: 0, institucional: inst([{ numero: '6001234567', numero_e164: '56912345678' }]), prefijos: [] }).ok, false);
  // flat institutional array is the old shape: rejected
  assert.equal(checkPayload({ schema_version: 1, secuencia: 1, generado_en: 0, institucional: ['6001234567'], prefijos: [] }).ok, false);
  // duplicated institutional numbers
  assert.equal(
    checkPayload({
      schema_version: 1,
      secuencia: 1,
      generado_en: 0,
      institucional: inst([
        { numero: '6001234567', numero_e164: '566001234567' },
        { numero: '6001234567', numero_e164: '566001234567' },
      ]),
      prefijos: [],
    }).ok,
    false,
  );
  // rangos no vacios no se publican en v0.1
  assert.equal(
    checkPayload({
      schema_version: 1,
      secuencia: 1,
      generado_en: 0,
      institucional: { numeros: [], rangos: [{ desde: '6001230000', hasta: '6001239999' }] },
      prefijos: [],
    }).ok,
    false,
  );
  assert.equal(
    listSize({ schema_version: 1, secuencia: 1, generado_en: 0, institucional: inst([{ numero: '6001234567', numero_e164: '566001234567' }]), prefijos: ['600', '809'] }),
    3,
  );
});
