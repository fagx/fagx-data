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
| Beta (v0.1 interno) | Secreto de GitHub Actions (`BLOCKLIST_SIGNING_KEY_BETA`); la instala BE-02 | Procedimiento de abajo |
| Producción | No existe aún. Ceremonia antes del primer release público; custodia doble según P-09 (dos copias cifradas, custodia separada; pendiente nombre del custodio, Q3) | Procedimiento de abajo, con ceremonia |

## Rotación planeada (sin compromiso)

1. Generar la clave nueva (`key_id` nuevo) y registrarla en el keyring del repo y en `assets/blocklist_keys.json` de la app, **junto a** la anterior.
2. Publicar la app con el keyring actualizado (o esperar a que la flota instalada lo tenga).
3. Pasar a firmar las listas con la clave nueva.
4. Cuando la telemetría/constatación interna indique que ya no quedan instalaciones firmando solo con la clave vieja, eliminarla del keyring y del secreto de Actions.
5. Registrar la rotación en `builds/` (modo `rotacion`, solo hashes y `key_id`, nunca números).

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
