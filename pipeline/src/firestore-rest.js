'use strict';
/**
 * Minimal Firestore REST client for the emulator dry-run.
 *
 * The dry-run runs against the Firestore emulator (firebase-tools,
 * --only firestore). It talks to the emulator's REST API so the CI job
 * needs no native dependencies. The pipeline stages receive a `store`
 * object, so the production pipeline (BE-02/BE-03) can swap in the
 * firebase-admin client without touching stage logic.
 */

class FirestoreEmulatorStore {
  constructor({ emulatorHost, projectId }) {
    // firebase emulators:exec exports FIRESTORE_EMULATOR_HOST as host:port
    this.host = emulatorHost || process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
    this.projectId = projectId || process.env.FIRESTORE_PROJECT_ID || 'fagx-dry-run';
    this.baseUrl = `http://${this.host}/v1/projects/${this.projectId}/databases/(default)/documents`;
  }

  async request(path_, method, body) {
    const res = await fetch(`${this.baseUrl}${path_}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`firestore REST ${method} ${path_} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 200 || res.status === 201) {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    return null;
  }
}

// --- field codec (only the types the pipeline uses) ---

function encodeValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  throw new TypeError(`unsupported field type: ${typeof v}`);
}

function decodeValue(raw) {
  if ('stringValue' in raw) return raw.stringValue;
  if ('booleanValue' in raw) return raw.booleanValue;
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return Number(raw.doubleValue);
  if ('nullValue' in raw) return null;
  throw new TypeError(`unsupported firestore value: ${JSON.stringify(raw).slice(0, 120)}`);
}

function encodeFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = encodeValue(v);
  return { fields };
}

function decodeFields(doc) {
  const out = {};
  for (const [k, raw] of Object.entries(doc.fields || {})) out[k] = decodeValue(raw);
  return out;
}

function docIdFromName(name) {
  return name.split('/').pop();
}

// --- store operations used by the pipeline stages ---

/** Create or overwrite a document with an explicit id. */
FirestoreEmulatorStore.prototype.setDoc = async function setDoc(collection, id, data) {
  await this.request(`/${collection}/${id}`, 'PATCH', encodeFields(data));
};

/** List all documents of a collection (dry-run scale only). */
FirestoreEmulatorStore.prototype.listDocs = async function listDocs(collection) {
  const res = await this.request(`/${collection}?pageSize=1000`, 'GET');
  return (res.documents || []).map((d) => ({ id: docIdFromName(d.name), data: decodeFields(d) }));
};

/** Remove every document of a collection (dry-run determinism). */
FirestoreEmulatorStore.prototype.clearCollection = async function clearCollection(collection) {
  const docs = await this.listDocs(collection);
  for (let i = 0; i < docs.length; i += 500) {
    await this.batchDelete(collection, docs.slice(i, i + 500).map((d) => d.id));
  }
  return docs.length;
};

/**
 * Read new reports since `cursor` (inclusive comparison is done in the
 * pipeline, Firestore supports GREATER_THAN).
 */
FirestoreEmulatorStore.prototype.queryReportsSince = async function queryReportsSince(cursor) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'reports' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'creado_en' },
          op: 'GREATER_THAN',
          value: { integerValue: String(cursor) },
        },
      },
      orderBy: [{ field: { fieldPath: 'creado_en' }, direction: 'ASCENDING' }],
      // this emulator build takes limit as a bare int32
      limit: 1000,
    },
  };
  const res = await this.request(':runQuery', 'POST', body);
  const out = [];
  for (const item of res || []) {
    if (item.document) out.push({ id: docIdFromName(item.document.name), data: decodeFields(item.document) });
  }
  return out;
};

/** Read a single document, or null. */
FirestoreEmulatorStore.prototype.getDoc = async function getDoc(collection, id) {
  try {
    const d = await this.request(`/${collection}/${id}`, 'GET');
    return { id, data: decodeFields(d) };
  } catch (err) {
    if (String(err).includes('404')) return null;
    throw err;
  }
};

/**
 * Delete documents. This emulator build rejects :batchWrite without
 * admin auth, so the dry-run store deletes documents individually while
 * the caller keeps the F-03 batching semantics (batches of 500, adaptive
 * budget). The production store (BE-02) performs real batched deletes.
 */
FirestoreEmulatorStore.prototype.batchDelete = async function batchDelete(collection, ids) {
  let deleted = 0;
  for (const id of ids) {
    const res = await this.request(`/${collection}/${id}`, 'DELETE');
    if (res !== null) deleted += 1;
  }
  return deleted;
};

module.exports = { FirestoreEmulatorStore };
