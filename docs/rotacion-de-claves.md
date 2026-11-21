# Rotación de claves de firma

**Proyecto:** Fagx · **Alcance:** v0.1 · **Estado:** vigente desde Ola 0
Referencia: P-09 (custodia, pendiente de Q3) · [Formato del sobre](sobre-firmado.md).

## Identificación

- Cada clave tiene un `key_id` único: `<nivel>-<año-mes>` (ejemplo: `solo-test-2026-11`). El keyring admite **varias** claves a la vez, así que la rotación no rompe instalaciones existentes.
- El keyring público del repo vive en `pipeline/keys/` (una carpeta por clave con `meta.json` + `public.pem`). El keyring empaquetado en la app (`assets/blocklist_keys.json`) contiene las mismas claves públicas.

## Niveles

| Nivel | Dónde vive | Rotación |
|---|---|---|
| `solo-test` | Commiteada, marcada desechable. Firmar fixtures con ella es intencional. | Rota cuando se quiera; se elimina cuando deja de usarse en fixtures |
| Beta (v0.1 interno) | Secreto de GitHub Actions (`BLOCKLIST_SIGNING_KEY_BETA`); el `key_id` se resuelve del keyring por coincidencia de la mitad pública (sin cambios de código al rotar) | Procedimiento de abajo · **rotada el 2026-11-21: `beta-2026-11` → `beta-2026-11-b`** |
| Producción | No existe aún. Ceremonia antes del primer release público; custodia doble según P-09 (dos copias cifradas, custodia separada; pendiente nombre del custodio, Q3) | Procedimiento de abajo, con ceremonia |

### Rotaciones ejecutadas

| Fecha | Clave retirada | Clave nueva | Motivo | Registro |
|---|---|---|---|---|
| 2026-11-21 | `beta-2026-11` (secreto de Actions sobrescrito; sin copias restantes) | `beta-2026-11-b` | El respaldo Q3 (dos copias cifradas) era imposible con la clave anterior: el secreto de Actions es write-only, así que FAG-32 aplicó la rotación y la clave nueva nació con ceremonia Q3 completa (dos copias cifradas, Fernando + CTO, passphrase separada por custodio) | `builds/` (modo `ceremonia-rotacion` + lista vacía de transición seq 2) · FAG-32 |

## Rotación planeada (sin compromiso)

1. Generar la clave nueva (`key_id` nuevo) y registrarla en el keyring del repo y en `assets/blocklist_keys.json` de la app, **junto a** la anterior.
2. Publicar la app con el keyring actualizado (o esperar a que la flota instalada lo tenga).
3. Pasar a firmar las listas con la clave nueva.
4. Cuando la telemetría/constatación interna indique que ya no quedan instalaciones firmando solo con la clave vieja, eliminarla del keyring y del secreto de Actions.
5. Registrar la rotación en `builds/` (modo `rotacion`, solo hashes y `key_id`, nunca números).

El paso 3 es mecánico: `publish` resuelve el `key_id` del keyring por coincidencia de la mitad pública del secreto (no hay `key_id` fijo en el código). En una rotación sin flota instalada (beta, v0.1) los pasos 2–4 se colapsan: la lista vacía de transición (`node run.js publish --lista-vacia`) firma con la clave nueva y el contenido real vuelve en la publicación siguiente.

## Procedimiento de compromiso

Si la clave privada beta/producción se ve comprometida:

1. Generar una clave nueva con `key_id` nuevo y agregarla al keyring.
2. **Publicar de inmediato una lista vacía firmada con la clave nueva** (la lista vacía contiene solo prefijos `600`/`809`): todas las instalaciones actualizan y dejan de usar contenido firmado por la clave comprometida.
3. Invalidar la clave vieja: eliminarla del keyring en el siguiente release de la app (las instalaciones ya no aceptan listas firmadas por ella).
4. Registrar el incidente en `builds/` y en el runbook (sección incidencias).

## Qué NUNCA va al repo

- Cualquier clave privada salvo la de `solo-test` (commiteada a propósito, desechable).
- La clave beta vive como secreto de Actions; la de producción, en custodia física cifrada según P-09.
- `pipeline/src/secrets-scan.js` falla el CI si aparece un bloque de clave privada fuera de `pipeline/keys/solo-test/`.
