# OMEGA CAMPUS CONCIERGE — GATE 05 CANONICAL CLOSE

**Fecha:** 2026-08-24
**Branch:** `omega-campus-concierge-gate04`
**Baseline funcional:** `5b32dbc884f39c62f1b38a3d2cb0d63711a0ccc4`
**Estado:** `CLOSED / CANONICAL`
**Commit de cierre:** el commit que contiene este documento y la implementación Gate 05.

## CURRENT_STATE

Gate 05 implementa el handoff Campus entre IA y operador humano, con persistencia Neon STAGING, autenticación específica de operador, APIs protegidas y Human Inbox aislada. El runtime normal del Campus y el boundary CAMPUS/NETROOM permanecen preservados.

## TARGET_IMPROVEMENT

Permitir el flujo completo:

`IA → HUMAN` mediante handoff persistido, claim atómico y estado `HUMAN_ACTIVE`.

`HUMAN → IA` mediante resolución `next_owner=AI`, estado `RETURNED_TO_AI` y contexto de reanudación.

También se admite cierre definitivo con `next_owner=CLOSE` y estado `CLOSED`.

## BASELINE_OR_EVIDENCE

- Baseline Gate 04: `5b32dbc884f39c62f1b38a3d2cb0d63711a0ccc4`.
- Fuente primaria funcional: Campus Profesional Enfermería.
- Neon Vercel Marketplace: recurso STAGING `omega-campus-staging`, base `neondb`, schema `public`.
- Tabla: `public.omega_handoffs`, sin datos reales.
- Eventos: `omega-events-v1`, incluyendo `handoff_created`.
- QA bridge: `?omega_debug=1`, apagado por defecto y sanitizado.

## SMALLEST_USEFUL_CHANGE

- Mantener OMEGUÍN como identidad, CORE como leyes, SKILLS como procedimientos y CHANNELS como adaptadores.
- Añadir sólo la base de contexto, persistencia, auth de operador, APIs y UI mínima necesarias para el handoff.
- Reutilizar `omega-handoff-persistence.js` y HMAC existente.
- No usar NETROOM como shortcut ni integrar datos académicos privados.

## ACCEPTANCE_CRITERIA

- `HANDOFF_CONTEXT v1` válido y sanitizado.
- `HANDOFF_RESOLUTION` conserva el contexto original.
- Identidad desconocida permanece `unverified`/no verificada.
- Datos NETROOM privados, transcript crudo, secretos y datos académicos quedan excluidos.
- Un handoff activo por conversación.
- Claim atómico `WAITING_HUMAN → HUMAN_ACTIVE`.
- Doble claim rechazado sin corrupción.
- Resolución AI/CLOSE transiciona a `RETURNED_TO_AI`/`CLOSED`.
- Sólo operadores autenticados acceden a APIs e Inbox.
- Roles server-side `OWNER` y `OPERATOR`.
- Inbox responsive con login, lista, detalle, claim y resolución.
- PROD, NETROOM y master sin mutaciones.

## VERIFICATION

QA funcional vigente: PASS para policy, builder/privacy, idempotencia, eventos, debug bridge, lifecycle Neon, operator auth, operator APIs, Human Inbox contract y regresiones Gate 04 seleccionadas.

Verificaciones ejecutadas:

- `tests/gate05-foundation-recovery.test.js`
- `tests/gate05-context-builder.test.js`
- `tests/gate05-runtime-integration.test.js`
- `tests/gate05-event-debug.test.js`
- `tests/gate05-lifecycle.test.js`
- `tests/gate05-operator-api.test.js` contra Neon STAGING con fixtures sintéticos limpiados.
- `tests/operator-auth.test.js`
- `tests/gate05-human-inbox.test.js`
- `tests/intelligence.test.js`
- HTML de Inbox servido localmente con HTTP 200; breakpoints desktop/mobile verificados por contrato CSS.

El test legacy `tests/handoff.test.js` requiere una variable `crypto` global dentro de su sandbox VM y falla antes de ejecutar la aserción funcional; no fue modificado ni se considera regresión de la implementación actual.

## REGRESSION_GUARD

- Gate 04: sin regresión funcional detectada.
- Conversación normal, precio, objeción e intención alta no generan handoff.
- Handoff duplicado reutiliza el mismo `handoff_id`.
- Respuestas API sanitizadas y sin transcript crudo.
- `DASHBOARD_PASSWORD` no concede acceso de operador.
- No se agregaron canales externos, dispatcher, CRM ni UI de Campus general.

## STANDARDIZATION

Estados canónicos:

`WAITING_HUMAN`, `HUMAN_ACTIVE`, `RETURNED_TO_AI`, `CLOSED`, `CANCELLED`, `FAILED`.

Contratos canónicos:

- `omega-handoff-context-v1`
- `HANDOFF_RESOLUTION`
- `omega-events-v1`

Persistencia canónica: `public.omega_handoffs` en Neon STAGING, con constraint de estados e índice único parcial para estados activos.

Auth canónica: cookie HMAC `campus_operator_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, con `operator_id` y `role` server-side.

## NEXT_KAIZEN_CYCLE

Gate 06 — OMEGA ONBOARDING, sólo después de una nueva autorización arquitectónica. No se inicia en este cierre.

## MUTATION GUARANTEE

- `PROD_MUTATIONS = 0`
- `NETROOM_MUTATIONS = 0`
- `MASTER_MUTATIONS = 0`
- `REAL_DATA_WRITES = 0`
