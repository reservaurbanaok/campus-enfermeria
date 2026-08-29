# STATUS

`OMEGA_GATE_04 = PASS` para validación local/STAGING del MVP acotado.

No deploy a PROD. No merge a master. NETROOM fuera del alcance.

## Gate 08 — Instagram staging runtime

PASS en `omega-campus-core-staging` para el flujo interno hasta el outbound
intent, sin llamada a Meta Graph. Deployment final: `9a7aee95-8b78-47e4-99b0-f10a032561cb`.
Fixtures controlados: válido, duplicado, firma inválida, malformado,
unsupported y handoff. No se configuró callback Meta.

## Gate 08 — Instagram Login OAuth STAGING

Publicado en `omega-campus-core-staging` el callback temporal
`/oauth/gate08/instagram/callback` y el inicio `/oauth/gate08/instagram`. El
intercambio server-side, state/CSRF, validación de identidad y consulta de
suscripción quedan cubiertos por pruebas sintéticas; el token sólo vive en
memoria. El estado de configuración histórica queda superseded por la
verificación operativa de Gate 08 registrada abajo.

## Gate 08 — OAuth state boundary y suscripción Instagram — 2026-08-28

El estado OAuth server-side one-time con TTL, consumo atómico y pruebas de
missing/invalid/expired/replay quedó verificado. El OAuth real alcanzó STAGING,
intercambió el token y validó la identidad; la frontera fallida fue
`instagram_messages_subscription_missing`.

Causa confirmada: el POST de `subscribed_apps` enviaba `subscribed_fields` sólo
en el cuerpo form-urlencoded. Se corrigió para usar el parámetro de consulta
oficial `?subscribed_fields=messages`, sin token en URL ni body. Fix desplegado
en STAGING, deployment `dae47724-1dfd-4295-ae59-c390f2c5f26c`.

La suscripción persistente y el outbound real quedan `NOT_CONFIRMED` hasta una
nueva autorización OAuth, porque el código autorizado anterior ya fue
consumido durante la verificación previa.

## Gate 08 — Instagram outbound readiness — 2026-08-28

El sender mínimo de texto para Instagram Login quedó implementado en
`api/_lib/instagram-outbound.js` y conectado únicamente al adapter Instagram.
Preserva el `sender.id` real del webhook como `recipient_id`, resuelve el token
desde la sesión OAuth STAGING, usa `graph.instagram.com` y no registra secretos.

Deployment STAGING verificado: `5ec4c37b-8348-4f71-b69f-95e11e3fae3f`.
`/healthz`, callback OAuth y `/oauth/gate08/instagram/status` autenticado
respondieron 200. Tests outbound, adapter Instagram, OAuth y regresión
WhatsApp/WF04 pasan. No se envió ningún mensaje Graph real.

`READY_FOR_SECOND_REAL_CANARY = YES`.

## Gate 08 — second real Instagram canary follow-up — 2026-08-28

Meta delivered the real canary to the corrected STAGING webhook. The signed
request reached HTTP 200 and the sanitized pipeline trace confirmed webhook
receipt, sender capture, `OMEGA_CHANNEL_MESSAGE_V1`, routing, Campus Core,
Canonical Core, skill routing and `OMEGA_CHANNEL_RESPONSE_V1`.

The first canary execution did not reach Graph outbound because the preceding
STAGING redeploy restarted the process and cleared the intentionally
memory-only OAuth session. A single new OAuth authorization for
`campus.enfermeria` then completed successfully on the active deployment.
Meta did not replay the already-acknowledged canary, and Codex did not resend
the DM or initiate another outbound message.

`SECOND_REAL_CANARY_INBOUND = PASS`.
`META_TO_STAGING = PASS`.
`INSTAGRAM_NORMALIZER = PASS`.
`OMEGA_CHANNEL_MESSAGE_V1 = PASS`.
`CAMPUS_CORE = PASS`.
`CANONICAL_CORE = PASS`.
`SKILL_ROUTING = PASS`.
`OMEGA_CHANNEL_RESPONSE_V1 = PASS`.
`INSTAGRAM_GRAPH_OUTBOUND = NOT_REACHED`.
`REAL_INSTAGRAM_REPLY = NOT_CONFIRMED`.
`READY_FOR_SECOND_REAL_CANARY = NOT_READY`.

## Gate 08 — durable Instagram OAuth runtime state — 2026-08-28

The volatile OAuth session boundary was replaced for STAGING Instagram only.
The credential is encrypted with AES-256-GCM using a dedicated Railway secret
and stored in the existing Campus Neon database. Only the Instagram adapter
reads the credential; public responses expose metadata only.

The successful OAuth result was persisted after identity and `messages`
validation. Deployment `0fcefa39-7d2f-44b7-bb28-c7954cc62f64` then restarted
STAGING, and boot restoration verified `campus.enfermeria`, Instagram User ID
`17841433759878333` and messaging permission `PASS` without browser OAuth.

`DURABLE_OAUTH_STORAGE = PASS`.
`CREDENTIAL_RESTORE_ON_BOOT = PASS`.
`REDEPLOY_SURVIVAL = PASS`.
`INSTAGRAM_OUTBOUND_PATH_READY = YES`.

The original real canary remains unreplayable from available safe evidence:
the accepted request has only sanitized correlation/sender hashes and HTTP
metadata; the in-memory replay map was lost by the prior process replacement,
and Meta stopped retrying after HTTP 200. No sender ID was fabricated and no
outbound message was sent by Codex.

`ORIGINAL_REAL_CANARY_PAYLOAD_RECOVERABLE = NO`.
`TRUE_HUMAN_ONLY_BLOCKER = YES`.
`NEXT_ACTION = ONE_NEW_EXTERNAL_DM_AFTER_DURABLE_STORAGE_PASS`.

## Gate 08 — Instagram canonical E2E close — 2026-08-28

The Owner confirmed immediate receipt of the automatic reply for the real
external DM `Hola, necesito información` sent to `@campus.enfermeria`.

Sanitized STAGING evidence identifies one matching execution at
`2026-08-28T20:13:21Z`: one message webhook, one complete OMEGA pipeline trace,
and one `instagram_send_attempt`. The pipeline sender hash matches the hash of
the Graph recipient ID, the business Instagram User ID is the expected one,
Graph returned HTTP 200, and a Meta message ID is present. No second send,
manual operator response, credential leakage, WhatsApp interaction, PROD
interaction or NETROOM interaction was observed.

The response text is not retained in logs; its automatic origin is established
by the OMEGA pipeline and sender events, and delivery is confirmed by the
Owner.

`OMEGA_GATE_08_SECOND_REAL_CANARY = PASS`.
`REAL_CANARY_INBOUND = PASS`.
`META_WEBHOOK_DELIVERY = PASS`.
`REAL_SENDER_ID_CAPTURE = PASS`.
`INSTAGRAM_NORMALIZER = PASS`.
`CHANNEL_ROUTING = PASS`.
`OMEGA_CHANNEL_MESSAGE_V1 = PASS`.
`CAMPUS_CORE = PASS`.
`CANONICAL_CORE = PASS`.
`SKILL_ROUTING = PASS`.
`OMEGA_CHANNEL_RESPONSE_V1 = PASS`.
`INSTAGRAM_SEND_ATTEMPT = PASS`.
`GRAPH_HOST = graph.instagram.com`.
`META_SEND_HTTP_STATUS = 200`.
`META_MESSAGE_ID = PRESENT`.
`REAL_REPLY_DELIVERY = PASS`.
`REAL_REPLY_CONFIRMED_BY_OWNER = YES`.
`DUPLICATE_OUTBOUND = NO`.
`MANUAL_OPERATOR_RESPONSE = NO`.
`OMEGA_GATE_08_INSTAGRAM_REAL_E2E = PASS`.
`INSTAGRAM_BRANCH_STATUS = READY_FOR_CANONICAL_FREEZE`.

## Gate 08 — Instagram canonical freeze — 2026-08-28

The Instagram branch is now closed and frozen as the canonical Gate 08
baseline. The durable credential, OAuth callback, account-level `messages`
subscription, real inbound, OMEGA processing, Graph outbound and Owner-
confirmed automatic reply are preserved as verified evidence.

`OMEGA_GATE_08_INSTAGRAM_BRANCH = CLOSED_PASS`.
`INSTAGRAM_BRANCH_STATUS = FROZEN_CANONICAL`.
`REOPEN_ONLY_ON_REGRESSION = YES`.
`GATE_08_INSTAGRAM = CLOSED_PASS`.
`GATE_08_FACEBOOK = DEFERRED_WITHIN_GATE_08`.
`GATE_08_OVERALL = PARTIAL_OPEN_BY_DEFERRED_BRANCH`.

No runtime behavior, Meta configuration, OAuth, canary or deployment action
was performed in this freeze operation. Facebook Messenger remains deferred
and requires separate Owner authorization.

## Gate 08 final closure — 2026-08-28

The Owner decided that the Facebook branch is out of scope because its
commercial audience quality/value does not justify further implementation or
investigation. Gate 08 is therefore fully closed while preserving the
canonical Instagram freeze:

`GATE_07_WHATSAPP = CLOSED_PASS_FROZEN`.
`GATE_08_INSTAGRAM = CLOSED_PASS_FROZEN_CANONICAL`.
`GATE_08_FACEBOOK = OUT_OF_SCOPE_BY_OWNER`.
`GATE_08_OVERALL = CLOSED_PASS`.

No runtime behavior was changed by this closure. Gate 09 is the next isolated
STAGING workstream and must not reopen Gate 08.

## Gate 09 — Commercial Intelligence MVP — 2026-08-28

The first missing boundary was durable storage for already-generated canonical
events. The MVP added an idempotent Neon STAGING Event Store, sanitized
non-blocking capture behind `OMEGA_COMMERCIAL_EVENT_STORE_ENABLED=true`, a
read-only KPI/Sensor API and the operator view at
`/dashboard/commercial-intelligence`.

The STAGING table was initialized and read through the deployed service using
only aggregate output: `event_store = ready`, `event_count = 0`, data quality
`PASS`, Sensor `INSUFFICIENT_DATA`, and conversation metrics `NO_DATA`. This is
`REAL_STAGING_DATA_STATUS = VALID_EMPTY_STATE`, not a fabricated zero and not
historical event reconstruction.

`DURABLE_EVENT_STORE = PASS`.
`EVENT_DATA_QUALITY = PASS`.
`KPI_ENGINE_V1 = PASS`.
`COMMERCIAL_SENSOR_V1 = PASS`.
`READ_ONLY_OPERATOR_VIEW = PASS`.
`METRIC_DICTIONARY = PASS`.
`REAL_STAGING_DATA_STATUS = VALID_EMPTY_STATE`.
`CHANNEL_REGRESSION = NONE`.
`WHATSAPP_MUTATIONS = 0`.
`INSTAGRAM_MUTATIONS = 0`.
`HANDOFF_MUTATIONS = 0`.
`PROD_MUTATIONS = 0`.
`NETROOM_MUTATIONS = 0`.
`OMEGA_GATE_09_MVP = PASS`.
`GATE_09_STATUS = MVP_READY`.

The next evidence-based improvement is to collect the first organic STAGING
events and expand coverage for `conversation_started`,
`enrollment_link_sent`, `enrollment_started` and `enrollment_completed` before
comparing funnel conversion percentages.

## Gate 09 — real event activation handoff — 2026-08-28

`TEST_EVENT_GENERATED = PASS`.
`TEST_EVENT_STORED = PASS`.
`TEST_EVENT_QUERYABLE = PASS`.
`TEST_EVENT_EXCLUDED_FROM_BUSINESS_METRICS = PASS`.
`REAL_EVENT_PATH_READY = PASS`.
`DASHBOARD_AUTH_CONFIGURED = NOT_CONFIGURED` (no existing STAGING credential
variables were present; no new credential was generated).
`REAL_EVENT_GENERATED = NOT_YET`.
`REAL_EVENT_STORED_NEON = NOT_YET`.
`BUSINESS_EVENT_COUNT = 0`.
`REAL_STAGING_DATA_STATUS = READY_FOR_REAL_TRAFFIC`.
`TRUE_HUMAN_ONLY_BLOCKER = YES` only for the physical external interaction.

Exact next action: send one external Instagram DM —
`Hola, necesito información sobre los cursos` — to `@campus.enfermeria`.
No further configuration, OAuth, canary repetition or synthetic business
event is required.

## Gate 09 — authenticated dashboard handoff — 2026-08-28

No canonical STAGING dashboard credential existed, so the authorized
STAGING-only credential generation path was used. The password and session
signing secret were configured through Railway without printing them; only a
local owner handoff containing the dashboard URL and password was created
outside Git.

`DASHBOARD_AUTH_CONFIGURED = PASS`.
`AUTHENTICATED_DASHBOARD = PASS`.
`AUTHENTICATED_DASHBOARD_API = 200`.
`UNAUTHENTICATED_API = 401`.
`SECURE_HANDOFF_FILE = CREATED`.
`GIT_TRACKED = NO`.

No real post-activation event exists yet: `BUSINESS_EVENT_COUNT = 0` and the
real STAGING state remains `READY_FOR_REAL_TRAFFIC`. The exact single Owner
action is the external Instagram DM specified above.

## Gate 09 — real event activation verified — 2026-08-28

The Owner-sent real Instagram conversation was captured without replay or
additional outbound. Neon contains one non-test business event at
`2026-08-28T21:00:37.558Z`: `intent_detected`, channel `instagram`, source
`omega_instagram_social_ingress`. Its sanitized correlation prefix matches the
single recent `instagram_pipeline_pass` trace; the recent trace contains one
send attempt only.

`REAL_EVENT_GENERATED = PASS`.
`REAL_EVENT_STORED_NEON = PASS`.
`REAL_EVENT_SCHEMA_VALID = PASS`.
`REAL_EVENT_SANITIZED = PASS`.
`TEST_EVENT = NO`.
`BUSINESS_EVENT_COUNT = 1`.
`REAL_EVENT_VISIBLE_KPI_ENGINE = PASS`.
`REAL_EVENT_VISIBLE_DASHBOARD = PASS`.
`REAL_EVENT_VISIBLE_COMMERCIAL_SENSOR = PASS`.
`TOP_MEASURED_SIGNAL = conversations_total = 1; intent_detected = 1`.
`REAL_STAGING_DATA_STATUS = REAL_DATA_VISIBLE`.
`OMEGA_GATE_09_REAL_EVENT_ACTIVATION = PASS`.

The Sensor correctly reports `INSUFFICIENT_DATA` for broader commercial
interpretation where the one conversation has no measurable course,
recommendation, objection or enrollment event. This is valid behavior, not a
missing-data-to-zero conversion.

## Gate 09 operational freeze / Gate 10 foundation — 2026-08-28

Gate 09 is now the passive operational baseline. Its event pipeline is frozen,
data collection remains active, and implementation reopens only on a proven
regression. The deployed coverage view reports the real current state:
`BUSINESS_EVENT_COUNT = 1`, `EVENT_TYPES_SEEN = intent_detected`,
`CHANNELS_SEEN = instagram`, `COURSES_SEEN = none`,
`EVENT_COVERAGE_STATUS = SUFFICIENT_FOR_BASIC_SIGNAL`.

`OMEGA_GATE_09_CANONICAL_OPERATIONAL_FREEZE = PASS`.
`GATE_09_MVP = CLOSED_PASS`.
`GATE_09_EVENT_PIPELINE = FROZEN_OPERATIONAL`.
`GATE_09_DATA_COLLECTION = ACTIVE`.
`COMMERCIAL_SENSOR = ACTIVE`.
`REOPEN_IMPLEMENTATION_ONLY_ON_REGRESSION = YES`.

Gate 10 foundation is design-only. The state machine, minimal identity bridge,
Next Best Course contract, event/KPI model and privacy boundary are documented
without NETROOM reads or mutations.

`OMEGA_GATE_10_FOUNDATION = PASS`.
`RETENTION_STATE_MACHINE_V1 = PASS`.
`NEXT_BEST_COURSE_CONTRACT_V1 = PASS`.
`MINIMAL_IDENTITY_BRIDGE_CONTRACT = PASS`.
`EVENT_MODEL = PASS`.
`PRIVACY_BOUNDARY = PASS`.
`NETROOM_READS = 0`.
`NETROOM_MUTATIONS = 0`.
`PROD_MUTATIONS = 0`.

## Gate 10 — onboarding + netroom_ready — 2026-08-28

Se instrumentaron los dos siguientes eventos de lifecycle en el receptor
Campus-only autenticado de Gate 06. `onboarding_started` requiere un
`enrollment_completed` previo; `netroom_access_ready` requiere además
`onboarding_started`. Ambos se persisten en el Event Store existente y la
proyección mantiene retención elegible sin habilitar próximo curso.

`ONBOARDING_STARTED_SIGNAL = PASS`.
`LIFECYCLE_TRANSITION_TO_ONBOARDING = PASS`.
`NETROOM_READY_SIGNAL = PASS`.
`LIFECYCLE_TRANSITION_TO_NETROOM_READY = PASS`.
`EVENT_STORE_PERSISTENCE = PASS`.
`RETENTION_PROJECTOR_INTEGRATION = PASS`.
`TEST_MATRIX = PASS`.
`FALSE_POSITIVE_NEXT_COURSE_ELIGIBILITY = 0`.

No existen señales reales disponibles en STAGING y no se fabricaron:
`REAL_ONBOARDING_VALIDATION = READY_FOR_REAL_SIGNAL` y
`REAL_NETROOM_READY_VALIDATION = READY_FOR_REAL_SIGNAL`.

`NETROOM_READS = 0`.
`NETROOM_MUTATIONS = 0`.
`PROD_MUTATIONS = 0`.

## Gate 10 — first authorized lifecycle signal — 2026-08-28

Se instrumentó el receptor Campus-only de `enrollment_completed` para el
bridge de Gate 06: HMAC, allowlist mínima, referencia de identidad permitida,
idempotencia por `event_id` y persistencia en el Event Store Neon existente.
La proyección inmediata valida `ENROLLED / RETENTION_ELIGIBLE` y mantiene
`NEXT_COURSE_EVALUATION_ELIGIBLE = NO`.

`ENROLLMENT_COMPLETED_INSTRUMENTATION = PASS`.
`EVENT_STORE_PERSISTENCE = PASS`.
`LIFECYCLE_TRANSITION_TO_ENROLLED = PASS`.
`RETENTION_PROJECTOR_INTEGRATION = PASS`.
`TEST_MATRIX = PASS`.
`FALSE_POSITIVE_COMPLETION = 0`.

No existe una inscripción confirmada real en STAGING para validar el receptor;
no se fabricó ninguna. `REAL_VALIDATION_STATUS = READY_FOR_REAL_ENROLLMENT_SIGNAL`.
La proyección real sigue `NOT_RETENTION_ELIGIBLE / PROSPECT` por la única
señal `intent_detected` existente.

`NETROOM_READS = 0`.
`NETROOM_MUTATIONS = 0`.
`PROD_MUTATIONS = 0`.
`FIRST_GATE_10_IMPLEMENTATION_TARGET = CAMPUS_ONLY_RETENTION_ELIGIBILITY_PROJECTION_V1`.

## Gate 10 — course_completed + Next Best Course V1 — 2026-08-28

Se completó la frontera funcional Campus-only en STAGING sin leer ni mutar
NETROOM. `course_completed` sólo puede ingresar desde el bridge HMAC autorizado,
con `completion_status=COMPLETED`, idempotencia por `event_id` y precondiciones
ordenadas `enrollment_completed → onboarding_started → netroom_access_ready`.
El evento se persiste en el Event Store Neon existente y proyecta
`COMPLETED / NEXT_COURSE_EVALUATION_ELIGIBLE` sólo con evidencia explícita.

Se implementó `next-best-course-v1` como evaluador read-only determinista. No
recomienda por completion, margen ni tiempo transcurrido; exige objetivo/interés
explícito y catálogo verificado cuya fuente primaria sea
`https://campusprofesionalenfermeria.com/`. Sin fit probado devuelve `NO`; sin
evidencia devuelve `INSUFFICIENT_DATA`; conflictos devuelven `HUMAN_REVIEW`.
No emite eventos por sí mismo.

`COURSE_COMPLETED_SIGNAL = PASS`.
`COURSE_COMPLETED_EVENT_PERSISTENCE = PASS`.
`LIFECYCLE_TRANSITION_TO_COMPLETED = PASS`.
`NEXT_COURSE_EVALUATION_ELIGIBILITY = PASS`.
`NEXT_BEST_COURSE_EVALUATOR_V1 = PASS`.
`CAMPUS_PRIMARY_SOURCE_ENFORCEMENT = PASS`.
`TEST_MATRIX = PASS`.
`FALSE_POSITIVE_COURSE_COMPLETION = 0`.
`FALSE_POSITIVE_NEXT_COURSE_RECOMMENDATION = 0`.

No existe completion real autorizado en la evidencia actual; por eso
`REAL_COURSE_COMPLETED_VALIDATION = READY_FOR_REAL_AUTHORIZED_SIGNAL` y
`CURRENT_REAL_NEXT_BEST_COURSE = NOT_EVALUABLE`.
`NETROOM_READS = 0`, `NETROOM_MUTATIONS = 0`, `PROD_MUTATIONS = 0`.

La revisión quedó Online en STAGING como deployment
`d4d4bcdc-2658-4abb-981d-9b6af429dc06`. Smoke real: health 200, ambos
receptores sin firma 401, dashboard autenticado 200; el Event Store conserva
exactamente un evento real `intent_detected`, sin `course_completed`.

## Gate 10 — Retention Eligibility Projection V1 — 2026-08-28

Se implementó y desplegó únicamente en STAGING un proyector Campus-only,
determinista y read-only sobre el Event Store Neon existente. El endpoint GET
protegido consulta por referencia de conversación/persona, excluye
`test_event=true`, devuelve sólo evidencia sanitizada y no lee NETROOM.

`RETENTION_PROJECTOR = PASS`.
`READ_ONLY = YES`.
`PROJECTION_VERSION = retention-eligibility-v1`.
`STATE_MATRIX_TESTS = PASS`.
`FALSE_POSITIVE_NEXT_COURSE_ELIGIBILITY = 0`.

La evidencia real actual (`intent_detected`, Instagram, sin ciclo de vida ni
curso) devuelve `NOT_RETENTION_ELIGIBLE` en estado `PROSPECT`; no se infirió
enrollment, onboarding, completion ni próximo curso.

`OMEGA_GATE_10_RETENTION_ELIGIBILITY_V1 = PASS`.
`NETROOM_READS = 0`.
`NETROOM_MUTATIONS = 0`.
`PROD_MUTATIONS = 0`.
