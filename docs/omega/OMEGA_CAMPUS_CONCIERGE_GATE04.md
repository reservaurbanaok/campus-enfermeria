# OMEGA CAMPUS CONCIERGE — GATE 04

Estado: PASS local/STAGING de alcance acotado. No se realizó deploy ni mutación de PROD o NETROOM.

## Kaizen

- Estado actual: Campus operativo sin Concierge comercial integrado.
- Mejora objetivo: primera experiencia conversacional comercial funcional.
- Cambio mínimo: widget aislado, core determinista, routing de admissions y tracking básico.
- Guardas: no se modificaron `guia-netroom`, `api/dashboard` ni datos privados.

## Fuente y límites

La fuente primaria es `https://campusprofesionalenfermeria.com/`. El core sólo contiene datos que ya aparecen en la oferta pública y conserva los formularios oficiales publicados. No inventa precios, fechas ni disponibilidad; para precios no publicados responde que corresponde consultar.

## Validación

- `node --check assets/omega-concierge.js`: PASS.
- `node --test tests/intelligence.test.js`: PASS.
- Browser local desktop: launcher/render/open/conversación: PASS.
- Browser local mobile 390x844: launcher/render: PASS.
- Routing factual: Diplomatura en Enfermería Escolar, 6 meses, online: PASS.
- Boundary NETROOM/progreso académico: rechazo explícito, sin consulta ni mutación: PASS.
- Tracking: eventos enviados a `window.dataLayer`, sin datos sensibles: PASS por inspección de código.

