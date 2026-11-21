# Formato del sobre firmado (`blocklist.json`)

**Proyecto:** Fagx · **Alcance:** v0.1 · **Estado:** vigente desde Ola 0
Referencias: [Plan v0.1](https://github.com/fagx/fagx-data) · Fase 0 (elección de JCA `SHA256withECDSA` sobre DER; rechazo a JWS por ambigüedad de canonicalización).

## Qué es

`blocklist.json`, publicado por GitHub Pages, es un **sobre firmado**: el payload de la lista va codificado en `payload_b64` y la firma va en `signature_b64`. La app **verifica la firma antes de parsear el payload**; si la verificación falla, la lista anterior queda intacta y se registra la incidencia.

## Campos del sobre

```json
{
  "format": "fagx-blocklist",
  "format_version": 1,
  "alg": "ES256",
  "key_id": "solo-test-2026-11",
  "payload_b64": "…(base64)…",
  "signature_b64": "…(base64)…"
}
```

| Campo | Valor | Verificación de la app |
|---|---|---|
| `format` | `fagx-blocklist`, fijo | Rechazar si difiere (`E_FORMAT`) |
| `format_version` | `1` | Rechazar si difiere (`E_FORMAT`) |
| `alg` | `ES256` (ECDSA P-256) | Rechazar si difiere (`E_ALG`) |
| `key_id` | Identificador de la clave verificadora | Rechazar si no está en el keyring (`E_UNKNOWN_KEY_ID`) |
| `payload_b64` | Payload canónico en base64 | Entrada de la verificación de firma |
| `signature_b64` | Firma en base64 | Verificación JCA |

## Canonicalización y firma

1. El payload se serializa como **JSON canónico**: claves de objetos ordenadas recursivamente por punto de código, sin espacios, UTF-8.
2. Los bytes UTF-8 del JSON canónico se codifican en base64 estándar → `payload_b64`.
3. La firma es **ECDSA P-256 en DER sobre los bytes ASCII exactos de `payload_b64`** (no sobre los bytes decodificados). En JCA: `Signature.getInstance("SHA256withECDSA")` sobre `getBytes(US_ASCII)` de `payload_b64`; la clave pública entra como `X509EncodedKeySpec` (PEM `PUBLIC KEY`, estándar SPKI).
4. En Node (este repo): `crypto.sign('sha256', Buffer.from(payload_b64, 'ascii'), { key, dsaEncoding: 'der' })`.

Firmar sobre la cadena base64 elimina toda ambigüedad de canonicalización del lado de la verificación: la app verifica sobre los bytes que descargó, sin re-serializar nada.

## Payload (v0.1)

```json
{
  "schema_version": 1,
  "secuencia": 1,
  "generado_en": 1795219200,
  "institucional": [],
  "prefijos": ["600", "809"]
}
```

| Campo | Significado |
|---|---|
| `schema_version` | Versión del payload. La app rechaza un `schema_version` **mayor** al soportado (`E_SCHEMA_VERSION`). |
| `secuencia` | Monótona creciente. La app rechaza una `secuencia` **menor** a la instalada (rollback, `E_SECUENCIA`). |
| `generado_en` | Epoch UTC de generación. La app rechaza un timestamp **a futuro** más allá de una tolerancia pequeña (`E_GENERADO_EN`). |
| `institucional` | Números `600XXXXXX` excluidos del bloqueo por prefijo (D4). En v0.1 viene de `data/institutional-allowlist.json`, editado solo por PR revisado. |
| `prefijos` | Prefijos bloqueados (D5): `600` y `809` fijos en v0.1. |

La app evalúa D3 (lista blanca) > D4 (institucional) > D5 (prefijos), en ese orden.

## Verificación de la app, en orden

1. `format`/`format_version`/`alg` correctos.
2. `key_id` presente en el keyring empaquetado (`assets/blocklist_keys.json`, admite varias claves).
3. Firma ECDSA/DER válida sobre `payload_b64`.
4. Tamaño del archivo ≤ 4 MB.
5. Parseo del payload y checks semánticos (`secuencia`, `generado_en`, `schema_version`).
6. Solo entonces, apply atómico y reconstrucción del índice caliente.

Cualquier fallo en 1–5 descarta **completa** la lista: no hay apply parcial.

## Keyring y niveles de clave

| Nivel | Clave | Dónde vive | Estado |
|---|---|---|---|
| Fixtures de test | `solo-test-2026-11` | Commiteada en `pipeline/keys/solo-test/` (intencional, desechable) | Activa para la lista vacía inicial y fixtures |
| Beta (v0.1 interno) | clave de firma de listas internas | Secreto de GitHub Actions; la instala BE-02 | Pendiente de BE-02 |
| Producción | clave real | No existe aún; ceremonia antes del primer release público (P-09, Q3) | Pendiente de custodia (Q3) |

La verificación del repo (`validate.yml`) usa el keyring de `pipeline/keys/`; las listas firmadas con la clave beta se validan en el pipeline de BE-02 con el secreto de Actions.

## Distribución y caché

- Pages sirve `https://fagx.github.io/fagx-data/blocklist.json`.
- La app pide con `?v=<epoch>` para saltarse el caché del CDN (~10 min, sin control de cabeceras).
- No existe `latest.json` (P-11): la URL es siempre la misma.

## Ejemplo con valores ficticios

Payload de prueba (números ficticios; nunca datos reales):

```json
{"generado_en":1795219200,"institucional":["600123456"],"prefijos":["600","809"],"schema_version":1,"secuencia":1}
```

(`600123456` es un número de laboratorio; las entradas reales llegan por PR revisado a `data/institutional-allowlist.json`.)
