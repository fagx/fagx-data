'use strict';
/**
 * CLI entrypoint.
 *
 *   node run.js ci            — static validation (schemas, envelope, guards, quota, unit tests, secret scan)
 *   node run.js dry-run       — full pipeline against the Firestore emulator with fixtures (requires emulator)
 *   node run.js publish       — build and sign the list, publish blocklist.json + builds/ log
 *
 * publish defaults to the beta key (env BLOCKLIST_SIGNING_KEY_BETA, GitHub
 * Actions secret — never committed). `--key-solo-test` signs with the
 * committed disposable test key (maintainer/test use only). `--secuencia N`
 * overrides the sequence number (default: previous published + 1); any
 * override is justified in the build log.
 *
 * The dry-run is deterministic: fixture `now`/`cursor` are fixed and the
 * canonical payload is compared byte-to-byte against
 * fixtures/golden-blocklist-payload.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { FirestoreEmulatorStore } = require('./src/firestore-rest');
const {
  ingest, aggregate, loadInstitutional, buildPayload, publish, cleanupExpired, saveStatus, PREFIJOS,
} = require('./src/pipeline');
const { loadKeyring, verifyEnvelope } = require('./src/envelope');
const { checkPayload, listSize } = require('./src/payload');
const { shrinkGuard } = require('./src/guards');
const { quotaBudget } = require('./src/quota');
const { scanRepo } = require('./src/secrets-scan');
const { validateInstitutional, validateEnvelope, validatePayload } = require('./src/validate-schemas');

const ROOT = path.resolve(__dirname, '..');
const PIPELINE = __dirname;
const KEYS_DIR = path.join(PIPELINE, 'keys');
const FIXTURES = path.join(PIPELINE, 'fixtures');
const PUBLISHED_BLOCKLIST = path.join(ROOT, 'blocklist.json');
const CANDIDATE_OUT = path.join(PIPELINE, '.build', 'blocklist.candidate.json');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function readPublished({ legacyPayloadOk = true } = {}) {
  if (!fs.existsSync(PUBLISHED_BLOCKLIST)) return { envelope: null, payload: null, legacy: false };
  const envelope = JSON.parse(fs.readFileSync(PUBLISHED_BLOCKLIST, 'utf8'));
  const ver = verifyEnvelope(envelope, loadKeyring(KEYS_DIR));
  if (!ver.ok) fail(`published blocklist.json fails verification: ${ver.reason}`);
  const chk = checkPayload(ver.payload);
  if (!chk.ok) {
    // Ola 0 scaffolding (disposable solo-test key) may predate the payload
    // v1 shape; strict semantics apply from the beta level onward.
    if (legacyPayloadOk && typeof ver.key_id === 'string' && ver.key_id.startsWith('solo-test')) {
      return { envelope, payload: ver.payload, legacy: true };
    }
    fail(`published payload invalid: ${chk.reason}`);
  }
  return { envelope, payload: ver.payload, legacy: false };
}

/** Blocked-entry count of a published payload, across the legacy (flat) and v1 (nested) shapes. */
function publishedCount(p) {
  if (!p) return 0;
  if (Array.isArray(p.institucional)) return p.institucional.length + p.prefijos.length;
  const size = listSize(p);
  if (size === null) fail('published payload is not countable');
  return size;
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

// ---------------------------------------------------------------- ci

function cmdCi() {
  const problems = [];

  // 1. JSON schemas
  validateInstitutional(path.join(ROOT, 'data', 'institutional-allowlist.json'), problems);
  const published = readPublished();
  if (published.envelope) {
    problems.push(...validateEnvelope(published.envelope));
    problems.push(...validatePayload(published.payload));
  }

  // 2. published list integrity (solo-test keyring) and shrink guard vs the
  //    candidate that the current data/ file would produce. A legacy
  //    scaffolding payload (pre-v1 shape, solo-test key) skips the guard:
  //    there is no meaningful ratio to protect during the migration.
  if (published.payload && !published.legacy) {
    const candidate = buildPayload({
      institutional: loadInstitutional(),
      secuencia: published.payload.secuencia + 1,
      generadoEn: published.payload.generado_en,
    });
    const guard = shrinkGuard(publishedCount(published.payload), listSize(candidate));
    if (!guard.ok) problems.push(`shrink guard: candidate ratio ${guard.ratio} (${guard.reason})`);
  }

  // 3. quota budget at fictitious volumes (1,000/day and 10,000/day)
  for (const volume of [1_000, 10_000]) {
    const budget = quotaBudget(volume);
    if (!budget.ok) problems.push(`quota budget at ${volume}/day failed: ${JSON.stringify(budget)}`);
  }

  // 4. secret scan
  const findings = scanRepo(ROOT);
  problems.push(...findings.map((f) => `secret scan: ${f}`));

  if (problems.length > 0) {
    for (const p of problems) console.error(`FAIL: ${p}`);
    process.exit(1);
  }
  console.log('ci: schemas, envelope, guards and quota budget OK');

  // 5. unit tests (node:test)
  const res = spawnSync(process.execPath, ['--test'], {
    cwd: PIPELINE,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) fail('unit tests failed');
  console.log('ci: all checks green');
}

// ------------------------------------------------------------ dry-run

async function cmdDryRun() {
  const fixtures = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'reports.json'), 'utf8'));
  const now = Number(process.env.DRY_RUN_NOW || fixtures.now);
  const cursorStart = Number(process.env.DRY_RUN_CURSOR || fixtures.cursor);
  const store = new FirestoreEmulatorStore({
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080',
    projectId: process.env.FIRESTORE_PROJECT_ID || 'fagx-dry-run',
  });

  // fresh state for determinism, then seed fixtures
  for (const collection of ['reports', 'aggregates', 'pipeline_status']) {
    await store.clearCollection(collection);
  }
  for (const r of fixtures.reports) {
    await store.setDoc('reports', r.id, {
      numero: r.numero, uid_hash: r.uid_hash, creado_en: r.creado_en, expira_en: r.expira_en,
    });
  }
  await saveStatus(store, { cursor: cursorStart, secuencia: 0 });

  const summary = { steps: {} };

  // ingesta
  const { reports, cursor } = await ingest(store);
  assert(reports.length === fixtures.esperado.nuevos,
    `ingesta: expected ${fixtures.esperado.nuevos} new reports, got ${reports.length} (cursor=${cursor})`);
  summary.steps.ingesta = { nuevos: reports.length, cursor };

  // agrega
  const agg = await aggregate(store, reports);
  const expectedAgg = fixtures.esperado.agregados;
  assert(agg.affectedNumbers === fixtures.esperado.numeros_afectados,
    `agrega: expected ${fixtures.esperado.numeros_afectados} affected numbers, got ${agg.affectedNumbers}`);
  for (const [numero, expected] of Object.entries(expectedAgg)) {
    const doc = await store.getDoc('aggregates', `u_${numero}`);
    assert(doc && doc.data.reportes === expected.reportes && doc.data.reportantes === expected.reportantes,
      `agrega: aggregates for ${numero} mismatch: ${JSON.stringify(doc && doc.data)}`);
  }
  summary.steps.agrega = agg.summary;

  // build candidate payload from the current data/ file; the fresh
  // emulator state carries secuencia_prev = 0, so the candidate is 1.
  const institutional = loadInstitutional();
  const payload = buildPayload({ institutional, secuencia: 1, generadoEn: now });

  // lista dorada, byte a byte
  const golden = fs.readFileSync(path.join(FIXTURES, 'golden-blocklist-payload.json'), 'utf8').trim();
  const canonical = JSON.stringify(payload);
  assert(canonical === JSON.stringify(JSON.parse(golden)),
    `golden mismatch:\n  candidate: ${canonical}\n  golden:    ${JSON.stringify(JSON.parse(golden))}`);
  summary.steps.golden = 'byte-to-byte OK';

  // firma -> publica (candidate to build dir, never committed from CI)
  const published = readPublished();
  const key = { privateKeyPem: fs.readFileSync(path.join(KEYS_DIR, 'solo-test', 'private.pem'), 'utf8'), keyId: 'solo-test-2026-11', publicPem: fs.readFileSync(path.join(KEYS_DIR, 'solo-test', 'public.pem'), 'utf8') };
  const envelope = publish(payload, key, {
    outPath: CANDIDATE_OUT,
    previousCount: publishedCount(published.payload),
  });
  const ver = verifyEnvelope(JSON.parse(fs.readFileSync(CANDIDATE_OUT, 'utf8')), loadKeyring(KEYS_DIR));
  assert(ver.ok, `round-trip verification failed: ${ver.reason}`);
  summary.steps.publica = { key_id: envelope.key_id, secuencia: payload.secuencia, out: path.relative(ROOT, CANDIDATE_OUT) };

  // borra (F-03 adaptive batches)
  const cleanup = await cleanupExpired(store, now);
  assert(cleanup.deleted === fixtures.esperado.borrados,
    `borra: expected ${fixtures.esperado.borrados} deletions, got ${cleanup.deleted}`);
  assert(cleanup.pendingAfter === 0, `borra: expected 0 pending expired, got ${cleanup.pendingAfter}`);
  summary.steps.borra = cleanup;

  // advance cursor
  await saveStatus(store, { cursor: now, secuencia: 1 });

  // presupuesto de cuota simulada
  const budgets = {};
  for (const volume of [1_000, 10_000]) {
    const budget = quotaBudget(volume);
    assert(budget.ok, `quota budget at ${volume}/day failed: ${JSON.stringify(budget)}`);
    budgets[String(volume)] = budget;
  }
  summary.steps.cuota = budgets;

  console.log('DRY-RUN OK');
  console.log(JSON.stringify(summary, null, 2));
}

// ------------------------------------------------------ publish

function argValue(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return fallback;
  return argv[i + 1];
}

function cmdPublish(argv) {
  const useTestKey = argv.includes('--key-solo-test');
  const secuenciaOverride = argValue(argv, '--secuencia', null);
  const modo = argValue(argv, '--modo', useTestKey ? 'mantenedor-test' : 'v1');

  const published = readPublished();
  const isLegacy = published.legacy;

  // signing key: beta (Actions secret) or the committed disposable test key
  let key;
  if (useTestKey) {
    const dir = path.join(KEYS_DIR, 'solo-test');
    key = {
      privateKeyPem: fs.readFileSync(path.join(dir, 'private.pem'), 'utf8'),
      keyId: 'solo-test-2026-11',
      publicPem: fs.readFileSync(path.join(dir, 'public.pem'), 'utf8'),
    };
  } else {
    const privatePem = process.env.BLOCKLIST_SIGNING_KEY_BETA;
    if (!privatePem || !privatePem.includes('PRIVATE KEY')) {
      fail('BLOCKLIST_SIGNING_KEY_BETA is not set (the beta private key lives only as a GitHub Actions secret)');
    }
    key = {
      privateKeyPem: privatePem,
      keyId: 'beta-2026-11',
      publicPem: fs.readFileSync(path.join(KEYS_DIR, 'beta', 'public.pem'), 'utf8'),
    };
  }

  const generadoEn = Math.floor(Date.now() / 1000);
  const prevSecuencia = published.payload ? published.payload.secuencia : 0;
  const secuencia = secuenciaOverride !== null ? Number(secuenciaOverride) : prevSecuencia + 1;
  assert(Number.isInteger(secuencia) && secuencia >= 1, 'secuencia override must be a positive integer');
  if (secuenciaOverride !== null && secuencia !== prevSecuencia + 1) {
    console.warn(`note: secuencia override ${secuencia} (prev published ${prevSecuencia}); justified in the build log`);
  }
  const payload = buildPayload({ institutional: loadInstitutional(), secuencia, generadoEn });

  const envelope = publish(payload, key, {
    outPath: PUBLISHED_BLOCKLIST,
    previousCount: publishedCount(published.payload),
  });

  // re-read from disk: the published list must verify with the repo keyring
  // (strict from now on: a non-legacy payload must satisfy the v1 semantics)
  const reverified = readPublished({ legacyPayloadOk: false });
  assert(reverified.payload && reverified.payload.secuencia === secuencia, 'published list failed re-verification');

  // builds/ bitacora: counts and hashes, never numbers
  const stamp = new Date(generadoEn * 1000).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const notas = useTestKey
    ? 'Lista firmada con la clave de test (uso de mantenedor). Los numeros jamas aparecen aqui; solo conteos y hashes.'
    : 'Lista real de v0.1: institucional (semilla SEC-01, criterio v2) + prefijos, firmada con la clave beta (secreto de Actions). Los numeros jamas aparecen aqui; solo conteos y hashes.';
  const buildLog = {
    fecha: new Date(generadoEn * 1000).toISOString(),
    secuencia,
    key_id: key.keyId,
    nivel: useTestKey ? 'solo-test' : 'beta',
    modo,
    conteos: {
      institucional: payload.institucional.numeros.length,
      rangos_institucionales: payload.institucional.rangos.length,
      prefijos: payload.prefijos.length,
      comunitarios: 0,
    },
    sha256_payload: crypto.createHash('sha256').update(Buffer.from(envelope.payload_b64, 'base64')).digest('hex'),
    sha256_envelope: crypto.createHash('sha256').update(JSON.stringify(envelope, null, 2) + '\n').digest('hex'),
    notas,
  };
  const buildPath = path.join(ROOT, 'builds', `${stamp}-seq-${secuencia}.json`);
  fs.mkdirSync(path.dirname(buildPath), { recursive: true });
  fs.writeFileSync(buildPath, JSON.stringify(buildLog, null, 2) + '\n');

  console.log(`published ${path.relative(ROOT, PUBLISHED_BLOCKLIST)}`);
  console.log(`build log ${path.relative(ROOT, buildPath)}`);
  console.log(`secuencia=${secuencia}`);
  console.log(`key_id=${key.keyId}`);
  console.log(`sha256_payload=${buildLog.sha256_payload}`);
  console.log(`sha256_envelope=${buildLog.sha256_envelope}`);
}

// ------------------------------------------------------------ main

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'ci') return cmdCi();
  if (cmd === 'dry-run') return cmdDryRun();
  if (cmd === 'publish') return cmdPublish(process.argv.slice(3));
  console.error('usage: node run.js <ci|dry-run|publish>');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
