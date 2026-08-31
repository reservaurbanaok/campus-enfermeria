# AI HANDOFF

Rama: `omega-campus-concierge-gate04`.

Rollback: retirar las dos líneas de assets agregadas al final de `index.html` y eliminar `assets/omega-concierge.css` y `assets/omega-concierge.js`.

Próximo paso exacto: owner QA visual y conversacional en un entorno STAGING publicado; después decidir si se abre un Gate posterior. No avanzar más allá de Gate 04.

Gate 08 quedó en la rama `codex/gate08-instagram-staging` y desplegado sólo en
`omega-campus-core-staging`. Rollback: volver a desplegar la última revisión
STAGING anterior a Gate 08. Próximo paso exacto: autorizar por separado el
callback Meta real y el outbound, manteniendo este adapter sin Graph API.

Movimiento posterior: configurar el secreto del sub-App Instagram fuera de Git
en `omega-campus-core-staging` y registrar únicamente el redirect URI STAGING
en el App 438. El callback ya está desplegado; no modificar WhatsApp/WF04 ni
desplegar a PROD.

Gate 08 update: el boundary OAuth state server-side quedó verificado y el fix
de suscripción `subscribed_fields=messages` fue desplegado sólo a STAGING.
Próximo paso exacto: completar una nueva autorización OAuth de
`campus.enfermeria` para certificar GET persistente, permiso outbound y
`READY_FOR_SECOND_REAL_CANARY`; no enviar el canario todavía.

Gate 08 outbound update: sender mínimo de texto implementado y desplegado en
STAGING. La readiness fue verificada sin tráfico Graph real; la sesión OAuth
activa y el GET autenticado de status respondieron 200. Próximo paso exacto:
desde una cuenta Instagram externa real, enviar un DM de texto a
`@campus.enfermeria` y seguir el correlation_id hasta la respuesta; no enviar
un DM proactivo desde la cuenta Campus.

Gate 08 durable runtime update: el credential context Instagram se cifra y
persiste en Neon STAGING, y sobrevivió un redeploy con restauración automática
de cuenta, ID y permiso `messages`. El canary real anterior no es replayable:
no quedó payload ni sender ID seguro tras la sustitución del proceso. Próximo
paso exacto: un único DM externo `Hola, necesito información` a
`@campus.enfermeria`; no enviar outbound proactivo.

Gate 08 Instagram canonical close: el Owner confirmó la respuesta automática
inmediata. La traza STAGING registra un único inbound completo y un único
outbound Graph HTTP 200 con `message_id` presente; el sender hash coincide con
el recipient hash. Instagram queda listo para freeze canónico. Próximo paso:
documentar/fijar esta baseline y tratar Facebook sólo en un movimiento futuro
autorizado; no ejecutar trabajo Facebook ahora.

Gate 08 Instagram freeze: documentación canónica actualizada. Estado:
`GATE_08_INSTAGRAM = CLOSED_PASS`, `INSTAGRAM_BRANCH_STATUS = FROZEN_CANONICAL`,
`GATE_08_FACEBOOK = DEFERRED_WITHIN_GATE_08` y
`GATE_08_OVERALL = PARTIAL_OPEN_BY_DEFERRED_BRANCH`. No reabrir Instagram salvo
regresión demostrada; no iniciar Facebook sin autorización del Owner.

Gate 08 final closure: el Owner decidió que Facebook queda
`OUT_OF_SCOPE_BY_OWNER` por baja calidad/valor comercial esperado. Estado
canónico: `GATE_07_WHATSAPP = CLOSED_PASS_FROZEN`,
`GATE_08_INSTAGRAM = CLOSED_PASS_FROZEN_CANONICAL`,
`GATE_08_FACEBOOK = OUT_OF_SCOPE_BY_OWNER` y `GATE_08_OVERALL = CLOSED_PASS`.
Próximo movimiento aislado: Gate 09 Commercial Intelligence MVP en STAGING;
no reabrir Gate 08 ni implementar Facebook.

Gate 09 MVP: Event Store Neon STAGING, KPI Engine, Commercial Sensor,
diccionario y vista GET-only quedaron desplegados y verificados. Estado:
`OMEGA_GATE_09_MVP = PASS`, `GATE_09_STATUS = MVP_READY`,
`REAL_STAGING_DATA_STATUS = VALID_EMPTY_STATE`. La tabla está lista y vacía;
no se fabricaron eventos históricos ni se envió tráfico para poblarla.
La prueba aislada `test_event=true` pasó almacenamiento, consulta y exclusión
de negocio, y fue eliminada. La autenticación del dashboard no tiene
credenciales existentes en STAGING; permanece protegida y no se generó ninguna
nueva credencial.
Próximo paso exacto: enviar un único DM externo `Hola, necesito información
sobre los cursos` a `@campus.enfermeria`; después seguir automáticamente el
evento hasta Neon, KPI, dashboard y Sensor. No repetir OAuth ni canary.

Gate 09 authentication: dashboard STAGING configured and verified. Login,
session status, authenticated commercial API and view all passed; unauthenticated
API remains 401. The owner password is available only in the local handoff
artifact outside Git; no session secret or credential was written to docs.
Business event count remains zero. Next exact action: one external Instagram
DM `Hola, necesito información sobre los cursos` to `@campus.enfermeria`, then
continue automatically through Neon, KPI, dashboard and Sensor.

Gate 09 real event activation: the Owner-sent DM is now visible as one
non-test, sanitized `intent_detected` event in Neon. Correlation matches the
single recent Instagram pipeline trace; authenticated KPI API and dashboard
read the event, and Commercial Sensor reports `MEASURED` with insufficient
sample for broader conclusions. State:
`OMEGA_GATE_09_REAL_EVENT_ACTIVATION = PASS`,
`REAL_STAGING_DATA_STATUS = REAL_DATA_VISIBLE`.
Next Kaizen: accumulate organic traffic and measure coverage before inferring
course demand or funnel conversion.

Gate 09 canonical operational freeze: pipeline frozen, collection active,
coverage observability deployed and implementation reopens only on regression.
Current real coverage is one Instagram `intent_detected`, no course ID, and
`SUFFICIENT_FOR_BASIC_SIGNAL`.

Gate 10 foundation: design-only artifact completed for Campus-only retention
and Next Best Course. State machine, minimal bridge, deterministic decision
contract, event/KPI model and privacy boundary pass. NETROOM reads/mutations
and PROD mutations remain zero. Next exact implementation target:
Campus-only `Retention Eligibility Projection V1`, read-only and based only on
authorized lifecycle events.

Gate 10 Retention Eligibility Projection V1: implementation and STAGING smoke
verification pass. The real current event remains `NOT_RETENTION_ELIGIBLE` /
`PROSPECT` because only `intent_detected` exists and no authorized lifecycle
evidence is present. Tests A-F pass, test fixtures are excluded, false-positive
next-course eligibility is zero, and the endpoint performs no writes. No
NETROOM, PROD, Gate 09, Instagram, WhatsApp or WF04 behavior changed.
Next Kaizen: identify and instrument only the first missing authorized
lifecycle signal required by real retention.

Gate 10 first lifecycle signal: the Campus receiver for the Gate 06
authoritative enrollment bridge is deployed in STAGING. HMAC, allowlist,
idempotency, Event Store persistence and `ENROLLED / RETENTION_ELIGIBLE`
projection pass in isolated tests. No real confirmed enrollment exists in
STAGING, so no synthetic business event was created; current real state remains
`NOT_RETENTION_ELIGIBLE / PROSPECT` and
`REAL_VALIDATION_STATUS = READY_FOR_REAL_ENROLLMENT_SIGNAL`.
Next Kaizen: instrument `onboarding_started` or `netroom_ready` only after the
authorized enrollment signal is actually received, without expanding NETROOM
access.

Gate 10 onboarding + readiness: both authorized lifecycle signal handlers are
implemented and deployed in STAGING. The chain is contract-tested as
`enrollment_completed → onboarding_started → netroom_access_ready`, with
`ONBOARDING` and `NETROOM_READY` projections both `RETENTION_ELIGIBLE` and no
next-course eligibility. No real lifecycle signal exists yet, so both real
validations remain `READY_FOR_REAL_SIGNAL`; no synthetic Neon event was
created. Next Kaizen: instrument authorized `course_completed` only.

Gate 10 final functional movement: `course_completed` was added to the
Campus-only Gate 06 HMAC receiver. It requires explicit `completion_status`,
ordered enrollment/onboarding/readiness evidence, persists as the existing
`omega-events-v1` event, and is idempotent. The retention projector now rejects
completion without ordered readiness and only exposes
`NEXT_COURSE_EVALUATION_ELIGIBLE` after the explicit event.

`next-best-course-v1` is a pure read-only evaluator. It accepts only an
authorized Campus lifecycle projection, explicit goals/interests, and a
verified catalog rooted at `https://campusprofesionalenfermeria.com/`. It
returns exactly one of `YES`, `NO`, `HUMAN_REVIEW`, or `INSUFFICIENT_DATA`, and
never emits `next_course_recommended` itself. The test matrix A-J passes with
zero false-positive completion and recommendation cases. Current real data has
only prospect intent, so real completion remains
`READY_FOR_REAL_AUTHORIZED_SIGNAL` and current next course is
`NOT_EVALUABLE`.

La implementación final quedó Online en STAGING en el deployment
`d4d4bcdc-2658-4abb-981d-9b6af429dc06`. El smoke no mutante pasó health 200,
rechazo 401 sin firma en ambos receptores, login/dashboard 200 y lectura
sanitizada del Event Store: un único `intent_detected`, cero
`course_completed`, estado real `PROSPECT / NOT_RETENTION_ELIGIBLE`.

## 2026-08-31 — Explore Options semantic quality patch

The first semantic gap was an empty catalog evidence chunk combined with a
false `VERIFIED` status when `course=null`. The STAGING patch extracts the
official catalog at runtime, requires relevant evidence for `EXPLORE_OPTIONS`,
expands catalog-intent matching, and removes only unbalanced WhatsApp markers.

Commit: `41efbce73f0f0a32c12c7b6d1a4bfb220d3cd182`.
Deployment: `d59fc301-2dac-4451-b906-b30ef7901a87`.
Validation: 7 catalog items, Explore Options 5/5, and regressions PASS.
