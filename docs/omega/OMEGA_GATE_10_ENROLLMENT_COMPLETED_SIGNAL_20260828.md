# OMEGA Gate 10 — First Real Lifecycle Signal

## Alcance y fuente

La fuente autoritativa identificada en Gate 06 es el flujo comercial de pago
aprobado: `payment_events`, orden `paid` y enrollment `active` en el dominio
NETROOM. Esta ejecución no lee ni modifica NETROOM. El Campus recibe esa
confirmación únicamente por un bridge autenticado y mínimo.

`ENROLLMENT_CONFIRMATION_SOURCE = Gate 06 payment/outbox bridge`
`CURRENT_EVENT_EMISSION = no conectado previamente a este Event Store STAGING`
`CURRENT_GAP = faltaba el receptor Campus autenticado para proyectar la señal`

## Cambio mínimo implementado

- Receptor STAGING: `POST /api/omega/lifecycle/enrollment-completed`.
- HMAC con secreto dedicado `CAMPUS_GATE06_ENROLLMENT_BRIDGE_SECRET`, ventana
  de reloj de cinco minutos e idempotencia por `event_id`/
  `X-Omega-Idempotency-Key`.
- Payload allowlist: evento, timestamp, curso canónico, referencia hash de
  persona o conversación y correlación. Se rechazan campos extra, cursos no
  canónicos, referencias de persona crudas y firmas inválidas.
- El servidor fija `event_type=enrollment_completed`,
  `source=gate06_enrollment_bridge`, `channel=campus_web` y autorización
  `enrollment_status=completed`; no acepta claims de pago ni datos académicos.
- Persistencia reutiliza `public.omega_commercial_events` con
  `omega-events-v1`; replay es no-op por la clave primaria existente.
- La proyección inmediata es `ENROLLED / RETENTION_ELIGIBLE`; no habilita
  `NEXT_COURSE_EVALUATION_ELIGIBLE`.

## Evidencia

- Tests focales de confirmación, firma, allowlist, idempotencia, persistencia,
  transición y falso positivo: 5/5 PASS.
- Tests del proyector Gate 10: 9/9 PASS.
- STAGING deployment: `ea0bb621-9fc5-410f-88b5-89ce877432fb`, Online.
- Smoke servido: health 200, login 200, POST sin firma 401, proyección real
  200 y API comercial 200.
- No se creó una inscripción ni un evento de negocio sintético en Neon.

## Estado real

No hay una confirmación autoritativa real disponible en STAGING para validar
el receptor automáticamente. El único evento real continúa siendo
`intent_detected`, por lo que la proyección vigente permanece
`NOT_RETENTION_ELIGIBLE / PROSPECT`.

`REAL_VALIDATION_STATUS = READY_FOR_REAL_ENROLLMENT_SIGNAL`

## Guardas

`NETROOM_READS = 0`, `NETROOM_MUTATIONS = 0`, `PROD_MUTATIONS = 0`.
Gate 09, Instagram, WhatsApp y WF04 no cambiaron. No se agregó UI ni se
modificó el sistema comercial de Gate 06.
