# DECISIONS

- Integración como assets independientes cargados al final de `index.html`.
- Core determinista y sin dependencias externas: el Campus sigue funcionando si el widget falla.
- Formularios oficiales reutilizados; abrirlos no se considera inscripción completada.
- Precios no publicados se derivan a consulta, sin inventar valores.
- Gate 08 usa una ruta social dedicada (`/webhook/gate08/instagram`) dentro del
  mismo proceso STAGING y llama `respondToMessage`; WF04 permanece separado.
- La deduplicación social usa `channel + external_message_id`; antes de crear
  un handoff se reutiliza el handoff activo de la conversación para respetar
  el índice único existente.
- Gate 08 OAuth usa el sub-App Instagram `4296194637360399`, scopes mínimos
  `instagram_business_basic` y `instagram_business_manage_messages`, state
  firmado y credential context cifrado durable en STAGING; no se reutiliza el
  flujo Facebook/Page.
- La suscripción Instagram usa `subscribed_fields=messages` como parámetro de
  consulta en `POST /{ig_user_id}/subscribed_apps`, manteniendo el token sólo
en el header Authorization; la persistencia debe verificarse con GET posterior.

- Gate 08 outbound usa un sender channel-specific de texto: el destino sólo
  puede ser el `sender.id` numérico proveniente del webhook Instagram y el
  endpoint es `POST https://graph.instagram.com/{version}/{ig_user_id}/messages`.
  La readiness se certifica con tests/mock y configuración; el primer envío
  real queda reservado al segundo canario iniciado por un DM entrante.
- El credential context de outbound Instagram STAGING se persiste únicamente
  después de validar identidad y `messages`, en la base Neon ya usada por
  Campus Core. El token se cifra con AES-256-GCM y una clave Railway dedicada;
  no se versiona, registra ni devuelve por endpoints públicos. El arranque
  restaura y vuelve a verificar identidad y suscripción antes de habilitar el
  sender.
- El inbound real confirmado por Owner queda como evidencia canónica de Gate 08:
  una sola ejecución OMEGA completa y un solo POST Graph aceptado en
  `graph.instagram.com`. La rama Instagram se congela; Facebook queda fuera
  de este movimiento.
- La rama Instagram queda `CLOSED_PASS` y `FROZEN_CANONICAL`; sólo se reabre
  ante una regresión demostrada. Facebook permanece
  `DEFERRED_WITHIN_GATE_08` y no se inicia en este movimiento.
- El Owner cerró Gate 08 en forma total: Instagram queda
  `CLOSED_PASS_FROZEN_CANONICAL`, Facebook pasa a
  `OUT_OF_SCOPE_BY_OWNER` y Gate 08 queda `CLOSED_PASS`. No se implementará ni
  investigará Facebook dentro de este alcance salvo una nueva decisión expresa.
- Gate 09 usa la Neon existente de STAGING como Event Store para no abrir otra
  base ni un ETL complejo. La captura es explícita, sanitizada, idempotente y
  no bloquea las respuestas de los canales congelados.
- El operador sólo recibe agregados por API GET y la vista comercial es
  read-only. `NO_DATA`, `ZERO` e `INSUFFICIENT_DATA` se mantienen separados
  para no fabricar porcentajes ni demanda histórica.
- Al no existir credenciales canónicas de dashboard en STAGING, se generaron
  sólo para STAGING con aleatoriedad criptográfica y se configuraron por
  Railway. El secreto de sesión no se entrega al Owner ni se documenta; el
  handoff local contiene únicamente URL y contraseña.
- Gate 09 se congela como infraestructura operacional: el pipeline no se
  reabre salvo regresión, pero la colección orgánica permanece activa. La
  cobertura es observabilidad pasiva y no cambia contratos de canal.
- Gate 10 comienza como diseño Campus-only. El futuro bridge sólo podrá llevar
  referencias mínimas de identidad/ciclo de vida; no se permite leer datos
  académicos privados de NETROOM ni recomendar por inferencia LLM sola.
- Gate 10 Retention Eligibility V1 reutiliza el Event Store Neon existente con
  una consulta GET protegida y un proyector determinista independiente. La
  elegibilidad de próximo curso requiere un `course_completed` explícito y
  autorizado; la intención comercial sola queda fuera de retención. No se
  agrega UI, tabla, migración, lectura NETROOM ni acción de canal.
- La primera señal de lifecycle se recibe desde el bridge de Gate 06, no desde
  una lectura directa de NETROOM. El receptor Campus exige HMAC, payload
  allowlist, curso canónico, referencia de identidad permitida y
  `event_id` idempotente; fija `enrollment_completed` sólo después de validar
  el contrato. La ausencia de un evento real mantiene el estado
  `READY_FOR_REAL_ENROLLMENT_SIGNAL`.
- `onboarding_started` y `netroom_access_ready` reutilizan el mismo receptor
  HMAC de Gate 06 con precondiciones forward-only verificadas en el Event Store
  Campus. La segunda señal sólo se acepta después de enrollment y onboarding;
  no se reemplaza por una lectura NETROOM ni por una inferencia de actividad.
- `course_completed` reutiliza ese receptor Campus-only, pero agrega
  `completion_status=COMPLETED` y exige la cadena ordenada completa hasta
  `netroom_access_ready`. Completion inferido, metadata de actividad, grades,
  evaluaciones o tiempo transcurrido nunca habilitan el estado COMPLETED.
- El evaluador `next-best-course-v1` es read-only y no produce eventos. Su única
  fuente comercial válida es el catálogo verificado de
  `https://campusprofesionalenfermeria.com/`; la ausencia de objetivo explícito,
  oferta compatible o datos oficiales produce un estado seguro sin recomendación.

## Semantic quality patch — Explore Options — 2026-08-31

Para `EXPLORE_OPTIONS`, `VERIFIED` sólo es válido cuando el contexto contiene
el catálogo actual solicitado. Se extraen en runtime los elementos
`.curso-card-title` de la fuente primaria, sin hardcodear la respuesta ni
modificar los recorridos de curso específico, canales o handoff.
