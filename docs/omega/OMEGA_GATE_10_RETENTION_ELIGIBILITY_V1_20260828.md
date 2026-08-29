# OMEGA Gate 10 — Retention Eligibility Projection V1

## Alcance

Implementación Campus-only, determinista, read-only y desplegada únicamente en
Railway STAGING. La proyección es una barrera de elegibilidad previa a
cualquier evaluación de próximo curso; no recomienda, no envía mensajes y no
lee NETROOM.

## Contrato implementado

- Módulo reusable: `api/_lib/retention-eligibility-projector.js`.
- Endpoint GET protegido: `/api/dashboard/retention-eligibility`.
- Fuente: sólo `public.omega_commercial_events` en Neon STAGING, seleccionada
  por `conversation_id` o referencia `sha256:` autorizada.
- Salida: `status`, `person_id_if_allowed`, `current_lifecycle_state`,
  `evidence_events` sanitizadas, `reason_codes`, `evaluated_at` y
  `projection_version=retention-eligibility-v1`.
- Fixtures `test_event=true` quedan excluidos y nunca se mezclan con analítica
  comercial.

Estados soportados: `INSUFFICIENT_DATA`, `NOT_RETENTION_ELIGIBLE`,
`RETENTION_ELIGIBLE`, `NEXT_COURSE_EVALUATION_ELIGIBLE` y
`HUMAN_REVIEW_REQUIRED`.

## Evidencia de implementación

- Matriz A-F y controles de sanitización/API: 9 tests Gate 10, todos PASS.
- Regresión Gate 07/08/09 seleccionada: 21 tests JavaScript, todos PASS.
- Deploy STAGING: Railway deployment
  `f0855011-2fb4-419e-babc-ca5fc69874de`, servicio
  `omega-campus-core-staging`, estado Online.
- Smoke funcional servido: health 200, login autenticado 200, API sin sesión
  401 y API de proyección autenticada 200.

## Estado real actual

La única evidencia comercial real consultable sigue siendo un evento
`intent_detected` de Instagram, sin evento de ciclo de vida autorizado ni
curso. La proyección resultante es:

```text
status = NOT_RETENTION_ELIGIBLE
current_lifecycle_state = PROSPECT
reason_codes = PROSPECT_STAGE, NO_LIFECYCLE_EVIDENCE
NEXT_COURSE_EVALUATION_ELIGIBLE = false
```

Esto es una salida segura: el sistema no convierte intención comercial en
inscripción, acompañamiento ni completion.

## Límites y regresión

No se consultó ni modificó NETROOM. No hubo migración, escritura del endpoint,
mutación de PROD, cambio de Gate 09, Instagram, WhatsApp o WF04. La proyección
se reabre sólo ante regresión demostrada o una nueva señal Campus autorizada.
