'use strict';
/**
 * CLI entrypoint.
 *
 *   node run.js ci            — static validation (schemas, envelope, guards, quota, unit tests, secret scan)
 *   node run.js dry-run       — full pipeline against the Firestore emulator with fixtures (requires emulator)
 *   node run.js publish-empty — one-shot local publish of an empty signed list (maintainer use)
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

function readPublished() {
  if (!fs.existsSync(PUBLISHED_BLOCKLIST)) return { envelope: null, payload: null };
  const envelope = JSON.parse(fs.readFileSync(PUBLISHED_BLOCKLIST, 'utf8'));
  const ver = verifyEnvelope(envelope, loadKeyring(KEYS_DIR));
  if (!ver.ok) fail(`published blocklist.json fails verification: ${ver.reason}`);
  const chk = checkPayload(ver.payload);
  if (!chk.ok) fail(`published payload invalid: ${chk.reason}`);
  return { envelope, payload: ver.payload };
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
  //    candidate that the current data/ file would produce.
  if (published.payload) {
    const candidate = buildPayload({
      institutional: loadInstitutional(),
      secuencia: published.payload.secuencia + 1,
      generadoEn: published.payload.generado_en,
    });
    const guard = shrinkGuard(listSize(published.payload), listSize(candidate));
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
    previousCount: published.payload ? listSize(published.payload) : 0,
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

// ------------------------------------------------------ publish-empty

function cmdPublishEmpty() {
  const published = readPublished();
  const secuencia = published.payload ? published.payload.secuencia + 1 : 1;
  const generadoEn = Math.floor(Date.now() / 1000);
  const payload = buildPayload({ institutional: loadInstitutional(), secuencia, generadoEn });

  const keysDir = path.join(KEYS_DIR, 'solo-test');
  const key = {
    privateKeyPem: fs.readFileSync(path.join(keysDir, 'private.pem'), 'utf8'),
    keyId: 'solo-test-2026-11',
    publicPem: fs.readFileSync(path.join(keysDir, 'public.pem'), 'utf8'),
  };
  const envelope = publish(payload, key, {
    outPath: PUBLISHED_BLOCKLIST,
    previousCount: published.payload ? listSize(published.payload) : 0,
  });

  // builds/ bitacora: counts and hashes, never numbers
  const stamp = new Date(generadoEn * 1000).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const buildLog = {
    fecha: new Date(generadoEn * 1000).toISOString(),
    secuencia,
    key_id: 'solo-test-2026-11',
    nivel: 'solo-test',
    modo: process.env.PUBLISH_MODE || 'inicial-ola-0',
    conteos: {
      institucional: payload.institucional.length,
      prefijos: payload.prefijos.length,
      comunitarios: 0,
    },
    sha256_payload: crypto.createHash('sha256').update(Buffer.from(envelope.payload_b64, 'base64')).digest('hex'),
    sha256_envelope: crypto.createHash('sha256').update(JSON.stringify(envelope, null, 2) + '\n').digest('hex'),
    notas: 'Lista vacia (solo prefijos 600/809) firmada con la clave de test. Los numeros jamas aparecen aqui; solo conteos y hashes.',
  };
  const buildPath = path.join(ROOT, 'builds', `${stamp}-seq-${secuencia}.json`);
  fs.mkdirSync(path.dirname(buildPath), { recursive: true });
  fs.writeFileSync(buildPath, JSON.stringify(buildLog, null, 2) + '\n');

  console.log(`published ${path.relative(ROOT, PUBLISHED_BLOCKLIST)} (secuencia=${secuencia})`);
  console.log(`build log ${path.relative(ROOT, buildPath)}`);
  console.log(`sha256_payload=${buildLog.sha256_payload}`);
}

// ------------------------------------------------------------ main

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'ci') return cmdCi();
  if (cmd === 'dry-run') return cmdDryRun();
  if (cmd === 'publish-empty') return cmdPublishEmpty();
  console.error('usage: node run.js <ci|dry-run|publish-empty>');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
