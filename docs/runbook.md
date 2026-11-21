# Runbook — `fagx-data`

**Proyecto:** Fagx · **Alcance:** v0.1 · **Estado:** vigente desde Ola 0

## Estructura

```
fagx-data/
├── blocklist.json                       # publicado por Pages (sobre firmado)
├── data/institutional-allowlist.json    # solo se edita por PR con revisión
├── schemas/                             # JSON Schema: lista institucional, sobre, payload
├── pipeline/                            # ingesta → agrega → firma → publica → borra
│   ├── run.js                           # cli: ci | dry-run | publish
│   ├── src/                             # etapas, sobre, guards, cuota
│   ├── test/                            # node:test (JVM-free, corren en segundos)
│   ├── keys/solo-test/                  # clave de test commiteada (intencional, desechable)
│   ├── keys/beta-2026-11-b/             # mitad pública de la clave beta vigente; la privada es secreto de Actions
│   ├── keys/beta/                       # mitad pública de la clave beta retirada (solo verificación histórica, seq 1)
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

La lista se publica con el workflow **`publish.yml`** (manual, `workflow_dispatch`): re-ejecuta la validación estática, construye el payload desde `data/`, firma con la **clave beta** (secreto de Actions `BLOCKLIST_SIGNING_KEY_BETA`; la clave privada nunca sale de Actions), commitea `blocklist.json` + la entrada de `builds/` y hace push — Pages (deploy from branch) sirve la lista nueva en minutos.

Para operaciones manuales de mantenedor (nivel test, desechable):

```bash
cd pipeline
node run.js publish --key-solo-test   # firma con la clave de test commiteada
# opciones: --secuencia N (override, justificado en la bitácora) · --modo TAG · --allow-shrink (override supervisado del guard)
# --lista-vacia: lista vacía de ceremonia (rotación/compromiso, P-09/Q3): solo prefijos 600/809, modo ceremonia-rotacion
# la ruta beta usa el mismo comando con BLOCKLIST_SIGNING_KEY_BETA en el entorno
```

Escribe `blocklist.json` + una entrada en `builds/` (conteos y hashes, nunca números).

### Cambiar `blocklist.json` a mano es un error

La lista se publica con `secuencia` creciente y sobre firmado; una edición manual rompe la cadena y el CI lo detecta (verificación de firma + guard de secuencia). El guard de encogimiento >50 % corre en cada publicación; una reducción mayor exige `--allow-shrink` documentado (los datos de v0.1 solo crecen por PR revisado).

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
