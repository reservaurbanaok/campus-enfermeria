# OMEGA Gate 10 — Onboarding + NETROOM Ready Signals

## Alcance

Se instrumentaron sólo las dos señales autorizadas siguientes al
`enrollment_completed`: `onboarding_started` y `netroom_access_ready`.
Campus recibe señales mínimas del bridge de Gate 06 mediante HMAC y consulta
únicamente el Event Store Campus/Neon para verificar la secuencia. No se lee ni
modifica NETROOM, no se consulta actividad académica y no se agregó UI.

## Fuentes autoritativas

- `ONBOARDING_CONFIRMATION_SOURCE = Gate 06 onboarding bridge`, con
  `onboarding_status=STARTED` explícito y enrollment previo en Campus.
- `NETROOM_READY_CONFIRMATION_SOURCE = Gate 06 identity bridge`, con
  `access_status=READY` explícito y enrollment + onboarding previos en Campus.

El receptor único es `POST /api/omega/lifecycle/gate06-signals`, con payload
allowlist, ventana HMAC de cinco minutos, referencias opacas, cursos
canónicos, correlación y `event_id` idempotente. El servidor fija el origen
canónico por tipo de señal.

## Evidencia

- `enrollment_completed → onboarding_started` produce `ONBOARDING /
  RETENTION_ELIGIBLE`.
- `enrollment_completed → onboarding_started → netroom_access_ready` produce
  `NETROOM_READY / RETENTION_ELIGIBLE`.
- Readiness sin inscripción/onboarding es rechazada con 409 y no escribe.
- Suite Gate 10 + regresiones Gate 07/08/09: 32/32 tests JavaScript PASS.
- Suite Python: 4/4 PASS.
- STAGING deployment final: `72d81ba4-ffb5-4d90-ba1a-e47e8936be90`, Online.
- Smoke servido: health 200, login 200 y ambos receptores sin firma 401.

## Estado real y guardas

No hay señales reales de lifecycle disponibles en STAGING; no se fabricaron.
`REAL_ONBOARDING_VALIDATION = READY_FOR_REAL_SIGNAL` y
`REAL_NETROOM_READY_VALIDATION = READY_FOR_REAL_SIGNAL`.

`CURRENT_TEST_PROJECTION = RETENTION_ELIGIBLE`.
`NEXT_COURSE_EVALUATION_ELIGIBLE = NO`.
`FALSE_POSITIVE_NEXT_COURSE_ELIGIBILITY = 0`.
`NETROOM_READS = 0`, `NETROOM_MUTATIONS = 0`, `PROD_MUTATIONS = 0`.
