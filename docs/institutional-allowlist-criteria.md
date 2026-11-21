# Criterio de inclusión — lista institucional semilla (SEC-01, F-01)

**Proyecto:** Fagx · **Archivo:** `data/institutional-allowlist.json` · **Versión del criterio:** 2
**Curador:** Security & Privacy (FAG-10) · **Fecha de verificación masiva:** 2026-11-21
**Refs:** Plan v0.1 · Desglose (fila SEC-01) · Especificación blocklist firmado, §3.4
**Historial:** v1 (2026-11-21) semilla inicial · v2 (2026-11-21) la exclusión institucional pasa a ser **configurable por el usuario** (decisión de la mesa en la revisión de SEC-01); reglas de curación sin cambios.

## 1. Propósito y regla de decisión que sirve

La app aplica la exclusión institucional (**D4**) *antes* del bloqueo por prefijo (**D5**). Sin esta lista, v0.1 bloquearía los `600` oficiales de bancos, aseguradoras y servicios el primer día: exactamente el peor falso positivo que el proyecto define como inaceptable (ajuste F-01 adoptado en Q2-A). En la configuración por defecto, una entrada en esta lista es un **PERMIT de máxima precedencia**: el número no se bloquea, ni por prefijo, ni por rango, ni por acumulación de reportes (§3.4 de la especificación de Fase 0); solo se remueve del *archivo de datos* por cambio manual justificado vía PR.

**Revisión v2 (decisión de la mesa, revisión SEC-01 del 2026-11-21):** la exclusión institucional es **configurable por el usuario**: activa por defecto, desactivable desde ajustes. La razón, en palabras de la mesa: *"en muchos casos también llaman bancos para ofrecer cosas y no es ni el banco de la persona, son otros"*. Con la exclusión desactivada, **D4 no se aplica**: los `600` institucionales quedan sujetos al bloqueo por prefijo (**D5**) como cualquier otro `600`. Esto no cambia la lista de datos ni su curación — el número sigue *siendo* un canal institucional publicado; cambia qué hace la app con esa clasificación. Los reportes de usuarios siguen sin remover entradas del archivo (§3.4 Fase 0): el switch es una preferencia local del dispositivo, no un canal de edición de la allowlist.

Por eso el criterio es deliberadamente **conservador**: es preferible un falso negativo (dejar fuera un número institucional que aún puede rescatarse con la lista blanca del usuario) que un falso positivo de allowlist (dar permiso permanente a un número que no es institucional).

## 2. Qué cuenta como "institución"

Se incluye a la entidad solo si pertenece a una de estas clases, verificable contra el registro o la actividad pública correspondiente:

| Clase (`categoria`) | Qué exige | Regulador/registro de referencia |
|---|---|---|
| `banco` | Banco autorizado en Chile | CMF (listado de bancos) |
| `cooperativa` | Cooperativa de ahorro y crédito supervisada | CMF |
| `aseguradora` | Compañía de seguros autorizada | CMF |
| `salud` | Isapre inscrita o organismo público de salud | Superintendencia de Salud / Minsal |
| `afp` | AFP registrada | Superintendencia de Pensiones |
| `telecomunicaciones` | Carrier o ISP con operación nacional | Subtel |
| `energia` | Distribuidora/concesionaria de electricidad o gas | SEC |
| `retail` | Cadena nacional con línea propia de servicio al cliente | — |
| `transporte` | Aerolínea con operación regular en Chile | DGAC |
| `gobierno` | Servicio público con línea 600 propia | — |

Se prefiere **una línea principal por institución** (SAC/atención de clientes). Se admiten entradas adicionales solo si la propia institución publica la línea como canal oficial *distinto* (p. ej. emergencias, línea de salida de postventa) y se documenta en `notas`.

## 3. Qué números son elegibles

1. **Formato:** `600` + 7 dígitos (10 dígitos nacionales). Se excluyen fijos (2/6x/7x), móviles (9…), `800`, `900`, códigos cortos (`103`, `105`, `101`, `1212`) y `*XX`: ninguno es afectado por el bloqueo de prefijo D5 y por tanto no necesita exclusión.
2. **Publicación activa:** el número debe estar publicado *hoy* por la institución como su propio canal de contacto (entrada, emergencias, venta o salida oficial declarada). Un número que solo aparece en archivos históricos, boletines antiguos o sitios de terceros no se incluye.
3. **Líneas de salida declaradas** sí cuentan (caso Ripley 600 329 2112): la institución declara que sus llamadas oficiales de postventa salen exclusivamente de ese número y pide no bloquearlo. Es el caso de uso exacto del filtro.

## 4. Fuentes aceptadas (en orden de confianza)

- **A. Sitio oficial de la institución** (dominio propio, HTTPS), incluidos PDFs y fichas alojados en su CDN oficial y su centro de ayuda claramente marcado y enlazado desde el dominio oficial (p. ej. instancia Zendesk con la marca de la institución).
- **B. Regulador o registro estatal**: CMF (bancos, cooperativas, tarjetas), Superintendencia de Salud (isapres), Superintendencia de Pensiones (AFP), ChileAtiende/Minsal. Se usan como fuente primaria cuando el sitio institucional no es verificable en automatizado, y como **corroboración** cuando sí lo es.
- **C. Cuentas sociales institucionales**: **solo como corroboración**, nunca como fuente única.

**Excluidas como fuente única:** directorios y guías telefónicas de terceros (amarillas, `telefonochile.cl`, `fonochile.com`, `sucursales.net`, etc.), comparadores, medios de prensa, foros, reportes de usuarios, listas no oficiales "de 600", tiendas de aplicaciones. El motivo es directo: el ataque relevante contra una allowlist es **envenenarla** (hacer pasar un número de spam como institucional), y las fuentes de terceros son exactamente el canal por donde eso ocurriría.

## 5. Disciplina de verificación (qué significa `verificado_en`)

- Cada entrada registra `fuente.url` + `fuente.verificado_en` (la fecha en que la fuente mostró el número).
- `metodo` declara cómo se verificó:
  - `fetch-directo`: el contenido de la página oficial se descargó y leyó el día indicado.
  - `contenido-indexado-del-dominio-oficial`: el sitio oficial bloquea clientes automatizados (403/WAF/JS) y el número se verificó contra el contenido indexado de esa misma URL oficial. El revisor humano debe hacer clic en `fuente.url` y confirmar en segundos; se acepta como método válido porque la URL es del dominio de la propia institución y es auditables por cualquiera.
- Número no verificable hoy → **no entra**; queda en pendientes (§8) o excluidos (§7).
- Ningún número entra "de memoria" ni por datos de entrenamiento: los 45 de la semilla tienen URL del 2026-11-21.

## 6. Formato del archivo y coordinación con AND-02/BE-02

```jsonc
// Ejemplo ilustrativo — número ficticio, no usar real:
{
  "institucion": "Institucion Ejemplo",
  "categoria": "banco",                 // vocabulario de §2
  "rol": "atencion-clientes",           // atencion-clientes | emergencias | venta | salida-postventa | asistencia-tecnica
  "numero_display": "600 000 0000",     // tal como lo publica la institucion
  "numero": "6000000000",               // forma nacional canonica, solo digitos
  "numero_e164": "566000000000",        // "56" + numero
  "fuente": {
    "tipo": "sitio-oficial",            // sitio-oficial | centro-ayuda-oficial | regulador
    "url": "https://…",                  // fuente del dia de verificacion
    "secundaria": "https://…",           // corroboracion opcional
    "verificado_en": "2026-11-21",
    "metodo": "contenido-indexado-del-dominio-oficial"
  },
  "notas": "…"
}
```

- **`numero`** es la forma nacional canónica (10 dígitos). Según el flujo de Fase 0 (§5, regla 7), un `600` recibido en forma nacional queda como "no normalizado" y solo matchea lista blanca e institucional exacta: para ese caso se usa `numero`.
- **`numero_e164`** cubre la entrega internacionalizada (`56` + número). La decisión de cuál forma ocupa el índice caliente es de **AND-02**; si la normalización final antepone `56`, se usa este campo.
- **Recomendación para BE-02:** emitir en `institucional.numeros` del payload ambas formas de cada entrada (`numero` y `numero_e164`). El costo es trivial (≤ 90 cadenas) y hace la exclusión inmune a la variante de entrega del carrier. El formato del payload **no cambia** con la revisión v2: la condicionalidad es de la app, no del sobre firmado.
- **Recomendación para AND-02 (motor, desde v2):** D4 consulta el ajuste local de exclusión institucional *antes* de perdonar un `600`. Ajuste activo (por defecto) → D4 aplica con la precedencia de siempre; ajuste desactivado → D4 se omite y sigue el flujo normal (D5 bloquea el prefijo `600`). El estado del ajuste nunca sale del dispositivo (sin telemetría) y no edita la lista: es solo una condición de evaluación.
- El **schema JSON propuesto** (`data/schemas/institutional-allowlist.schema.json`) queda a disposición de BE-01 para `validate.yml`: exige el patrón `^600\d{7}$`, unicidad de números, vocabularios cerrados y `verificado_en` en ISO-8601.

## 7. Excluidos de esta ola (documentados, con motivo)

| Institución | Motivo |
|---|---|
| Banco Security | Su SAC publica solo fijo (2 258 44060); tras la integración BICE–Security, la línea 600 400 2400 de BICE atiende a clientes de ambas marcas |
| Banco HSBC | Emergencia solo fijo (56 2 2299 7200) según CMF |
| Isapre Colmena Golden Cross | "Golden Phone" es fijo (2 3322 3000); sin 600 publicado |
| Claro Chile | Solo 800 (800 171 171 / 800 171 800) |
| WOM (móvil) | Atención móvil vía 103 / 2 2337 7600; su único 600 es de Fibra (incluido) |
| CGE | Solo 800 (800 800 767) |
| Aguas Andinas | Solo *8000 / fijo (2 2731 2400) |
| ChileAtiende | Call center 101 — código corto, no afectado por D5 |

## 8. Pendientes de verificación (candidatos, no incluidos)

Con respaldo de fuente oficial o registro, pendientes de verificación manual/fetch: **Sky Airline** (sitio JS, sin fetch), **Registro Civil** (WAF bloquea verificación automática), BNP Paribas Cardif, Reale Chile, cooperativas menores del listado CMF (Oriencoop 600 200 0015, Coocretal 600 892 5000, Coonfía 600 361 0120, Ahorrocoop 600 360 0020), y líneas secundarias ya vistas en fuentes oficiales: Entel cancelaciones 600 360 0103, Movistar Empresas 600 600 3200, Scotiabank Experiencia 600 600 1100, VTR reclamos 600 310 0105, Enel electrodependientes 600 697 1500, Bci emergencias 600 692 9000, Banco Internacional empresas 600 363 5000, BICE empresas/inversiones 600 400 1010 / 600 400 4000, Ripley venta telefónica 600 520 2020, LATAM Cargo 600 300 5000. Se agregan en oleas siguientes por PR, con el mismo criterio.

## 9. Mantenimiento y revisión

- **Solo por PR con ≥1 revisión**; la lista nunca se edita por pipeline ni por reportes de usuarios (v0.1 no tiene reportes).
- **Re-verificación:** se recomienda ciclo de 90 días por entrada; `validate.yml` debería advertir (no fallar) cuando `verificado_en` supere 180 días.
- **Remoción:** solo con justificación en el PR (la institución deja de publicar el número, cambio de marca, fraude confirmado contra el propio canal). La acumulación de reportes de usuarios jamás remueve una entrada (§3.4 Fase 0).
- **Alcance congelado:** v0.1 no agrega categorías nuevas (p. ej. municipios, colegios, OOSS regionales) sin un PR que amplíe este criterio.
- El archivo es **público por diseño** (repo `fagx-data`): contiene únicamente números de canales institucionales publicados, nombres de instituciones y URLs de fuentes públicas. Sin PII, sin datos de usuarios, sin secretos.

## 10. Semilla actual — resumen

45 entradas verificadas el 2026-11-21: bancos 14 · cooperativa 1 · aseguradoras 6 · salud 7 · AFP 5 · telecomunicaciones 4 · energía 1 · retail 5 · transporte 2. Métodos: 6 `fetch-directo` (CMF ×4: CMR, Consorcio call center, Coopeuch, Tarjeta Presto · Minsal/Salud Responde · centro de ayuda oficial Ripley) y 39 `contenido-indexado-del-dominio-oficial`; 16 entradas con fuente secundaria, de las cuales 14 son pares sitio+regulador (ChileAtiende corrobora a Fonasa como secundaria, no como fetch-directo).

---

*Nota de publicación en `fagx-data`: los enlaces internos al tablero de Fagx (FAG-*) se conservan como referencias textuales; este documento es el criterio vigente aprobado en la revisión de SEC-01 (2026-11-21).*
