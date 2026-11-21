# Runbook — `fagx-data`

**Proyecto:** Fagx · **Alcance:** v0.1 · **Estado:** vigente desde Ola 0

## Estructura

```
fagx-data/
├── blocklist.json                       # publicado por Pages (sobre firmado)
├── data/institutional-allowlist.json    # solo se edita por PR con revisión
├── schemas/                             # JSON Schema: lista institucional, sobre, payload
├── pipeline/                            # ingesta → agrega → firma → publica → borra
│   ├── run.js                           # cli: ci | dry-run | publish-empty
│   ├── src/                             # etapas, sobre, guards, cuota
│   ├── test/                            # node:test (JVM-free, corren en segundos)
│   ├── keys/solo-test/                  # clave de test commiteada (intencional, desechable)
│   └── fixtures/                        # reportes ficticios + lista dorada del dry-run
├── builds/                              # bitácora por publicación: conteos y hashes, nunca números
└── docs/                                # este runbook, formato del sobre, rotación
```

## CI (`validate.yml`, cada PR)

| Check | Qué hace |
|---|---|
| Schemas | `data/institutional-allowlist.json`, sobre y payload contra `schemas/` |
| Sobre publicado | Verificación de firma con el keyring del repo + checks semánticos |
| Guard 50 % | La lista candidata no puede encoger >50 % vs la publicada |
| Cuota simulada | Presupuesto a 1.000/día y 10.000/día ficticios dentro de las cuotas Spark |
| Secret scan | Ninguna clave privada fuera de `pipeline/keys/solo-test/`; sin tokens |
| Tests | node:test: round-trip firma/verificación, negativos, guards, schemas |
| Dry-run | Pipeline completo contra el Firestore emulator con fixtures, lista dorada byte a byte |

## Desarrollo local

```bash
cd pipeline
npm ci
node run.js ci                 # validación estática + tests

# dry-run contra el emulador (requiere Java 17+):
npx firebase-tools emulators:exec --only firestore --project fagx-dry-run "node run.js dry-run"
```

El dry-run es determinista: siembra fixtures ficticios (`pipeline/fixtures/reports.json`), ejecuta las cinco etapas (ingesta → agrega → firma → publica → borra), compara el payload candidato **byte a byte** contra `fixtures/golden-blocklist-payload.json`, verifica el round-trip de firma con la clave de test, simula el borrado adaptativo de vencidos (F-03) y valida el presupuesto de cuota. El candidato queda en `pipeline/.build/` (no se commitea).

## Publicación

La publicación automatizada la implementa BE-02 (pipeline v1, firma con clave beta desde un secreto de Actions). Para la lista inicial y operaciones manuales de mantenedor:

```bash
cd pipeline
node run.js publish-empty      # firma lista vacía con la clave de test
```

Escribe `blocklist.json` + una entrada en `builds/` (conteos y hashes, nunca números). **Solo la clave de test firma así**; la beta/producción usan su propio camino.

### Cambiar `blocklist.json` a mano es un error

La lista se publica con `secuencia` creciente y sobre firmado; una edición manual rompe la cadena y el CI lo detecta (verificación de firma + guard de secuencia en BE-02).

## Guard de encogimiento (>50 %)

Una publicación que deje la lista con menos de la mitad de entradas falla el CI. Encogimiento intencional (ej.: purga de entradas institucionales erróneas):

1. PR que explica el porqué, con la revisión correspondiente (Security & Privacy si toca la lista institucional).
2. El mantenedor ejecuta la publicación con override supervisado (`--allow-shrink` en el comando de publicación del pipeline) y lo deja anotado en la descripción del PR.
3. La entrada en `builds/` registra el modo `encogimiento-supervisado`.

## Cuota y alertas

Presupuesto simulado (constantes del plan; consumo real se registra en `builds/`):

| Volumen ficticio | Lecturas/día | Escrituras/día | Borrados/día | Capacidad de borrado |
|---|---|---|---|---|
| 1.000/día | ~1.021 | ~22 | 1.000 | 18.000 (4 corridas × 4.500) |
| 10.000/día | ~10.201 | ~202 | 10.000 | 18.000 |

- Cuotas Spark de referencia: 50.000 lecturas, 20.000 escrituras, 20.000 borrados por día.
- **Alerta operativa:** si los vencidos pendientes superan 10.000 (umbral `pendingAlertThreshold`), el pipeline reporta `ALERT_PENDING_EXPIRED` — ver F-03 (lotes adaptativos) en el veredicto de Fase 0.
- Los commits programados de publicación mantienen los workflows de este repo por encima de los 60 días de inactividad de GitHub.

## Pages

1. Settings → Pages → Source: **Deploy from a branch**, rama `main`, carpeta `/ (root)`.
2. `blocklist.json` queda en `https://fagx.github.io/fagx-data/blocklist.json`.
3. La app pide con `?v=<epoch>` (~10 min de caché de CDN, sin control de cabeceras).

## Incidencias

| Síntoma | Acción |
|---|---|
| Lista publicada inválida o firma rota | Re-publicar con `publish-empty` (o pipeline beta) y abrir incidencia; la app nunca aplica una lista que no verifica |
| Clave beta comprometida | Procedimiento de [rotación de claves](rotacion-de-claves.md) (lista vacía firmada con clave nueva) |
| Vencidos pendientes > 10.000 | Revisar corridas del pipeline; el borrado adaptativo absorbe picos hasta 18.000/día |
| Workflow desactivado por inactividad | Re-activarlo en Actions; los commits programados de BE-02 evitan que vuelva a pasar |
