'use strict';
/**
 * Pipeline stages: ingesta -> agrega -> firma -> publica -> borra.
 *
 * Stages take a `store` (Firestore client) so the same logic runs
 * against the emulator (dry-run, CI) and against production (BE-02).
 *
 * v0.1 list content: institucional (from data/institutional-allowlist.json,
 * edited only by reviewed PRs) + prefijos (600/809, D5). Community
 * aggregation maintains aggregates/ for the v0.2 track (BE-03 adds
 * F-03 adaptive deletes and F-04 reporter-window pruning) but community
 * numbers are never part of the v0.1 payload.
 */

const fs = require('fs');
const path = require('path');
const { signEnvelope, verifyEnvelope } = require('./envelope');
const { checkPayload, listSize } = require('./payload');
const { shrinkGuard } = require('./guards');
const { quotaBudget, MODEL } = require('./quota');

const REPORTS_COLLECTION = 'reports';
const AGGREGATES_COLLECTION = 'aggregates';
const STATUS_COLLECTION = 'pipeline_status';
const STATUS_DOC = 'global';

const ALLOWLIST_PATH = path.resolve(__dirname, '..', '..', 'data', 'institutional-allowlist.json');

/** Fixed D5 prefixes published in every v0.1 list (Plan v0.1, A2). */
const PREFIJOS = ['600', '809'];

// --- ingesta ---

/** Read reports created after the stored cursor. Returns { reports, cursor } */
async function ingest(store) {
  const status = await store.getDoc(STATUS_COLLECTION, STATUS_DOC);
  const cursor = status && status.data.cursor_en ? status.data.cursor_en : 0;
  const reports = await store.queryReportsSince(cursor);
  return { reports, cursor };
}

// --- agrega ---

/**
 * Increment aggregate counters for each reported number.
 * Reports carry already-normalized numbers and hashed reporter ids
 * (uid_hash) — raw ids never leave the app.
 */
async function aggregate(store, reports) {
  const byNumber = new Map();
  for (const r of reports) {
    const numero = r.data.numero;
    if (!byNumber.has(numero)) byNumber.set(numero, { count: 0, reporters: new Set() });
    const entry = byNumber.get(numero);
    entry.count += 1;
    entry.reporters.add(r.data.uid_hash);
  }
  let writes = 0;
  const summary = [];
  for (const [numero, entry] of byNumber) {
    const id = `u_${numero}`; // dry-run id; production uses uid-hash-scoped ids (create-only rules)
    const existing = await store.getDoc(AGGREGATES_COLLECTION, id);
    const prevReporters = existing ? existing.data.reportantes || 0 : 0;
    const next = {
      reportes: (existing ? existing.data.reportes || 0 : 0) + entry.count,
      reportantes: prevReporters + entry.reporters.size,
      actualizado_en: Date.now() > 0 ? Math.floor(Date.now() / 1000) : 0,
    };
    await store.setDoc(AGGREGATES_COLLECTION, id, next);
    writes += 1;
    summary.push({ numero, reportes: next.reportes, reportantes: next.reportantes });
  }
  // NOTE (BE-03): aggregates will carry ventana_reportantes {uid_hash ->
  // creado_en} so the 90-day window can shrink (finding F-04). Not in
  // the v0.1 pipeline.
  return { affectedNumbers: summary.length, writes, summary };
}

// --- build payload ---

/**
 * Load the institutional allowlist seed (data/institutional-allowlist.json).
 * Returns entries carrying both delivery forms (numero + numero_e164),
 * as agreed with SEC-01/AND-02 (criterio §6, FAG-28).
 */
function loadInstitutional(path_ = ALLOWLIST_PATH) {
  const data = JSON.parse(fs.readFileSync(path_, 'utf8'));
  const entries = data.entradas.map((e) => ({
    numero: e.numero,
    numero_e164: e.numero_e164,
  }));
  const numbers = entries.map((e) => e.numero);
  if (new Set(numbers).size !== numbers.length) {
    throw new Error('institutional allowlist: duplicate numbers');
  }
  for (const e of entries) {
    if (e.numero_e164 !== '56' + e.numero) {
      throw new Error(`institutional allowlist: numero_e164 mismatch for ${e.numero}`);
    }
  }
  return entries;
}

/**
 * Build the candidate payload. `secuencia` is the previous published
 * secuencia + 1 (never lower: the app rejects rollback). Institutional
 * entries carry both forms; `rangos` is always empty in v0.1.
 */
function buildPayload({ institutional, secuencia, generadoEn }) {
  return {
    schema_version: 1,
    secuencia,
    generado_en: generadoEn,
    institucional: {
      numeros: [...institutional].sort((a, b) => (a.numero < b.numero ? -1 : a.numero > b.numero ? 1 : 0)),
      rangos: [],
    },
    prefijos: [...PREFIJOS].sort(),
  };
}

// --- firma + publica ---

/**
 * Sign the payload and produce the envelope. With `outPath` set, write
 * the envelope as blocklist.json (publish stage; dry-run writes to the
 * build output dir, never committing from CI).
 */
function publish(payload, signingKey, { outPath, previousCount } = {}) {
  const check = checkPayload(payload);
  if (!check.ok) throw new Error(`payload invalid: ${check.reason}`);

  const guard = shrinkGuard(previousCount ?? 0, listSize(payload));
  if (!guard.ok) throw new Error(`shrink guard failed: ${guard.reason}`);

  const envelope = signEnvelope(payload, signingKey);
  const verification = verifyEnvelope(envelope, {
    keys: [{ key_id: signingKey.keyId, publicPem: signingKey.publicPem }],
  });
  if (!verification.ok) throw new Error(`self-verification failed: ${verification.reason}`);

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(envelope, null, 2) + '\n');
  }
  return envelope;
}

// --- borra (F-03: adaptive batches) ---

/**
 * Delete expired reports with adaptive batches: batches of 500 up to the
 * prudent per-run cap (delete capacity per day = runs x cap). Returns
 * the number deleted and the remaining pending count; the caller alerts
 * when pending exceeds the threshold (runbook).
 */
async function cleanupExpired(store, nowEpoch) {
  const all = await store.listDocs(REPORTS_COLLECTION);
  const expired = all.filter((d) => Number(d.data.expira_en) < nowEpoch).map((d) => d.id);
  const pending = expired.length;
  const toDelete = expired.slice(0, MODEL.prudentCapPerRun);
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += MODEL.batchSize) {
    const batch = toDelete.slice(i, i + MODEL.batchSize);
    deleted += await store.batchDelete(REPORTS_COLLECTION, batch);
  }
  return { deleted, pendingAfter: pending - deleted, pending: pending };
}

/** Advance the cursor and bump the secuencia after a successful run. */
async function saveStatus(store, { cursor, secuencia }) {
  await store.setDoc(STATUS_COLLECTION, STATUS_DOC, { cursor_en: cursor, secuencia });
}

module.exports = {
  PREFIJOS,
  REPORTS_COLLECTION,
  AGGREGATES_COLLECTION,
  STATUS_COLLECTION,
  STATUS_DOC,
  ingest,
  aggregate,
  loadInstitutional,
  buildPayload,
  publish,
  cleanupExpired,
  saveStatus,
};
