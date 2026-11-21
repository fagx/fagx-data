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
  /**
   * `admin: true` sends the emulator's admin token (`Bearer owner`), which
   * bypasses security rules — the pipeline service account's stand-in. With
   * `admin: false` the store speaks as an unauthenticated client, so rules
   * enforcement is exercised exactly as the app would hit it.
   */
  constructor({ emulatorHost, projectId, admin = true, authUid = null } = {}) {
    // firebase emulators:exec exports FIRESTORE_EMULATOR_HOST as host:port
    this.host = emulatorHost || process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
    this.projectId = projectId || process.env.FIRESTORE_PROJECT_ID || 'fagx-dry-run';
    this.baseUrl = `http://${this.host}/v1/projects/${this.projectId}/databases/(default)/documents`;
    this.admin = admin;
    this.authUid = authUid;
  }

  authHeader() {
    if (this.admin) return `Bearer owner`;
    if (this.authUid) return `Bearer ${emulatorIdToken(this.authUid, this.projectId)}`;
    return undefined;
  }

  async request(path_, method, body) {
    const res = await fetch(`${this.baseUrl}${path_}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(this.authHeader() ? { Authorization: this.authHeader() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`firestore REST ${method} ${path_} -> ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
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
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    // plain object -> Firestore map (ventana_reportantes, cleanup state)
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = encodeValue(val);
    return { mapValue: { fields } };
  }
  throw new TypeError(`unsupported field type: ${typeof v}`);
}

function decodeValue(raw) {
  if ('stringValue' in raw) return raw.stringValue;
  if ('booleanValue' in raw) return raw.booleanValue;
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return Number(raw.doubleValue);
  if ('nullValue' in raw) return null;
  if ('mapValue' in raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw.mapValue.fields || {})) out[k] = decodeValue(v);
    return out;
  }
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

/**
 * Unsigned ID-token-shaped JWT the emulator accepts as request.auth
 * (the emulator decodes the claims and skips signature verification,
 * exactly like a rules unit test's authenticatedContext). Only for
 * emulator probes — never sent to production.
 */
function emulatorIdToken(uid, projectId) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'none', typ: 'JWT' });
  const claims = b64({
    sub: uid,
    user_id: uid,
    aud: projectId,
    iss: `https://securetoken.google.com/${projectId}`,
    auth_time: now - 60,
    iat: now - 60,
    exp: now + 3_600,
  });
  return `${header}.${claims}.`;
}

// --- store operations used by the pipeline stages ---

/** Create or overwrite a document with an explicit id. */
FirestoreEmulatorStore.prototype.setDoc = async function setDoc(collection, id, data) {
  await this.request(`/${collection}/${id}`, 'PATCH', encodeFields(data));
};

/** List all documents of a collection, following page tokens (dry-run scale). */
FirestoreEmulatorStore.prototype.listDocs = async function listDocs(collection) {
  const out = [];
  let pageToken = '';
  do {
    const url = `/${collection}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await this.request(url, 'GET');
    for (const d of res.documents || []) {
      out.push({ id: docIdFromName(d.name), data: decodeFields(d) });
    }
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return out;
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
    if (err.status === 404) return null;
    throw err;
  }
};

/**
 * Fire a request and return its HTTP status instead of throwing — the
 * rules test asserts on statuses (denied = 403, allowed = 2xx) exactly
 * as a rules unit test would assert on outcomes.
 */
FirestoreEmulatorStore.prototype.probe = async function probe(path_, method, body) {
  const headers = {
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(this.authHeader() ? { Authorization: this.authHeader() } : {}),
  };
  const res = await fetch(`${this.baseUrl}${path_}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  await res.text().catch(() => '');
  return res.status;
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

module.exports = { FirestoreEmulatorStore, emulatorIdToken };
