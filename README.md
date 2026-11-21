# fagx-data

Repositorio **público** de datos y pipeline de **Fagx**, filtro de llamadas para Chile (bloqueo por prefijos `600`/`809`), privado por diseño.

- La **lista firmada** (`blocklist.json`) se publica por GitHub Pages y la app Android la verifica con JCA (`SHA256withECDSA`) **antes de parsear**.
- El **pipeline** (ingesta → agrega → firma → publica → borra) corre como GitHub Action; los secretos viven en Actions, nunca en el repo.
- El historial de la lista (commits + `builds/`) queda **público y auditable**: conteos y hashes, jamás números.
- La app es privada: [`fagx-app`](https://github.com/fagx/fagx-app) (decisión F-09 del veredicto de Fase 0).

## Estructura

| Ruta | Contenido |
|---|---|
| `blocklist.json` | Lista firmada publicada por Pages (formato en [`docs/sobre-firmado.md`](docs/sobre-firmado.md)) |
| `data/institutional-allowlist.json` | Lista institucional semilla (D4); se edita **solo** por PR con revisión |
| `pipeline/` | Pipeline de publicación + clave de test + fixtures del dry-run |
| `builds/` | Bitácora por publicación: secuencia, conteos y hashes, nunca números |
| `schemas/` | JSON Schema de la lista institucional, del sobre y del payload |
| `docs/` | Formato del sobre firmado, [rotación de claves](docs/rotacion-de-claves.md), [runbook](docs/runbook.md) |

## CI

`validate.yml` corre en cada PR y en `main`:

1. JSON Schema de la lista institucional y del sobre publicado.
2. Pipeline completo en **dry-run** contra el Firestore emulator con fixtures ficticios, lista dorada comparada byte a byte.
3. Round-trip de firma/verificación con la clave de test.
4. Guard: la lista no puede encoger >50 % en una publicación.
5. Presupuesto de cuota simulada (1.000/día y 10.000/día ficticios) dentro de las cuotas Spark.
6. Escaneo de secretos (ninguna clave privada fuera de `pipeline/keys/solo-test/`).

## Claves

La clave de `pipeline/keys/solo-test/` está commiteada **a propósito** (nivel *fixtures* del plan): es un par de prueba desechable, marcado `solo-test`, usado para la lista vacía inicial y los tests. La clave beta de v0.1 vive como secreto de Actions y la instala BE-02; la de producción no existe aún (ceremonia P-09/Q3 antes del primer release público).

## Desarrollo local

```bash
cd pipeline
npm ci
node run.js ci
npx firebase-tools emulators:exec --only firestore --project fagx-dry-run "node run.js dry-run"
```

Ver el [runbook](docs/runbook.md) para publicación, guard de encogimiento, cuotas e incidencias.
