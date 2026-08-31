# RISKS

- El contenido factual puede cambiar en la Source of Truth; actualizar el catálogo antes de ampliar respuestas.
- Tracking usa `dataLayer` si existe y no persiste PII; no hay backend de conversaciones.
- La verificación realizada es local/STAGING; no certifica PROD.
- El callback Meta real sigue sin configurarse y el outbound intent no se
  transforma en una llamada Graph hasta un movimiento posterior autorizado.
- `INSTAGRAM_META_APP_SECRET` es configuración STAGING externa a Git; no se
  imprime ni se comparte con el repositorio.
- El OAuth Instagram Login requiere `INSTAGRAM_LOGIN_APP_SECRET` y el redirect
  URI exacto en configuración STAGING externa a Git; el callback no devuelve el
  token al navegador y ahora lo persiste cifrado en Neon.
- El primer OAuth real posterior al fix de state consumió su código al alcanzar
  la frontera de suscripción; no se reutiliza. La nueva forma oficial del POST
  está desplegada, pero requiere otra autorización para verificarse en Meta.

## Gate 08 outbound readiness — 2026-08-28

- El sender real no fue ejercitado contra Meta durante readiness por diseño; el
  primer tráfico Graph saliente queda reservado al segundo canario real.
- La sesión activa OAuth puede vivir en memoria del proceso, pero el credential
  context cifrado durable permite restaurarlo tras un redeploy sin reautorizar.
- WhatsApp, WF04, Gate 07, PROD y NETROOM no fueron modificados.

## Gate 08 durable credential state — 2026-08-28

- `INSTAGRAM_CREDENTIAL_ENCRYPTION_KEY` es un secreto Railway STAGING
  dedicado. Si se rota sin migrar la fila cifrada y reautorizar una vez, el
  credential context no podrá restaurarse; no hay fallback a texto plano.
- El replay store del webhook sigue siendo en memoria; la persistencia durable
  implementada en este ciclo cubre el credential context, no reconstruye un
  payload histórico ya reconocido con HTTP 200.
- La entrega visual del E2E canónico depende de la confirmación del Owner; en
  este caso ya fue confirmada. No se debe repetir el canary ni generar outbound
  proactivo durante el freeze.
- El cierre es de la rama Instagram, no del Gate 08 completo: Facebook queda
  diferido y cualquier continuación requiere autorización explícita. Reabrir
  Instagram sólo ante regresión demostrada.

## Gate 08 final closure — 2026-08-28

- El Owner retiró Facebook del alcance por baja calidad/valor comercial
  esperado. `GATE_08_OVERALL = CLOSED_PASS`; no existe una investigación
  Facebook pendiente en este ciclo.
- Gate 09 debe permanecer aislado en STAGING y no reabrir la baseline
  Instagram ni modificar WhatsApp, WF04, Gate 07, PROD o NETROOM.

## Gate 09 MVP — 2026-08-28

- La tabla durable está lista, pero el rango validado actualmente está vacío:
  `REAL_STAGING_DATA_STATUS = VALID_EMPTY_STATE`. No se deben interpretar los
  `NO_DATA` como cero comercial ni usar el Sensor para decisiones hasta que
  existan eventos reales.
- La cobertura de `campus_web` durable sigue pendiente porque su tracking
  vigente es client-side en memoria. El MVP no agrega un transporte de
  transcripciones ni cambia ese runtime.
- La captura de ingress se habilita sólo con
  `OMEGA_COMMERCIAL_EVENT_STORE_ENABLED=true` en STAGING; si se deshabilita,
  la vista conserva sus semánticas pero no recibirá nuevos eventos.
- El acceso al dashboard depende ahora de credenciales nuevas exclusivas de
  STAGING. La contraseña sólo existe en el handoff local fuera de Git y el
  secreto de firma permanece en Railway; rotarlos requiere repetir el
  handoff, sin afectar PROD ni los canales congelados.

## Gate 10 foundation — 2026-08-28

- El único evento comercial real actual permite una señal básica, no una
  tendencia ni una recomendación de curso. `INSUFFICIENT_DATA` es el estado
  correcto hasta contar con evidencia explícita de ciclo de vida y fit.
- Cualquier bridge de lifecycle debe ser allowlist y contract-tested antes de
  habilitarse; no debe convertirse en un atajo hacia grades, progreso,
  intentos o actividad privada de NETROOM.
- `NEXT_COURSE_OPPORTUNITY` no autoriza outbound ni enrollment. La eventual
  acción de canal requerirá una decisión separada de consentimiento, permisos
  y auditoría.

## Gate 10 Retention Eligibility Projection V1 — 2026-08-28

- La cobertura real sigue limitada a un `intent_detected` de Instagram; la
  salida correcta es `NOT_RETENTION_ELIGIBLE`, no una inferencia de enrollment
  o completion.
- El proyector sólo acepta señales de lifecycle explícitas y autorizadas. Una
  evidencia incompatible devuelve `HUMAN_REVIEW_REQUIRED`; no se resuelve por
  inferencia temporal ni por LLM.
- La siguiente mejora requiere instrumentar sólo la primera señal Campus de
  lifecycle autorizada que falte para retención; no habilita lecturas privadas
  de NETROOM ni outbound.

## Gate 10 — enrollment_completed bridge — 2026-08-28

- El receptor está desplegado en STAGING, pero la validación real queda
  pendiente de una confirmación emitida por el bridge autoritativo de Gate 06;
  no se puede sustituir por un click, mensaje, pago declarado o fixture.
- El secreto HMAC dedicado del receptor debe coincidir con el emisor autorizado
  cuando ese bridge se conecte; rotarlo requiere coordinación de configuración,
  nunca un bypass de firma.
- La ausencia de `enrollment_completed` no habilita retención ni próximo curso:
  el dato real continúa correctamente en `NOT_RETENTION_ELIGIBLE`.

## Gate 10 — onboarding + netroom_ready — 2026-08-28

- Las señales están listas en STAGING, pero aún no hay evidencia real para
  validarlas; los tests aislados no se convierten en datos de negocio.
- `netroom_access_ready` permanece bloqueado sin enrollment y onboarding
  previos, evitando una transición permisiva por un bridge mal correlacionado.
- La señal de readiness sólo representa acceso operacional confirmado; no
  habilita lecturas de progreso, lecciones, evaluaciones ni datos académicos.

## Gate 10 — course_completed + Next Best Course V1 — 2026-08-28

- No hay productor real de completion disponible en este repositorio. El
  receptor queda listo para el bridge autorizado y no fabrica una señal para
  cerrar el gate.
- La recomendación depende de que un proceso de catálogo entregue evidencia
  verificada de la fuente primaria actual. Si esa evidencia no está disponible,
  el resultado correcto es `INSUFFICIENT_DATA`, no una sugerencia basada en
  memoria o en datos históricos.
- El evaluador excluye términos genéricos como `salud` para evitar matches
  comerciales amplios; si persisten fits iguales, devuelve `HUMAN_REVIEW`.

## Semantic quality patch — Explore Options — 2026-08-31

- La extracción depende de la estructura pública `.curso-card-title`; si el
  sitio cambia esa estructura, el guard debe degradar a `INSUFFICIENT`.
- La fuente es remota y cacheada por cinco minutos; los datos comerciales se
  consideran vigentes sólo dentro de la evidencia recuperada en runtime.

## Gate 08 — Instagram durable token lifecycle — 2026-08-31

- `expires_at` histórico no es una prueba de validez: la respuesta viva de
  Meta es autoritativa y una OAuthException 190 deja la credencial como
  `INVALID_REAUTH_REQUIRED`, preservando la fila cifrada para rollback.
- El refresh sólo aplica a credenciales `LONG_LIVED` con edad de al menos 24 h
  y 10 días o menos restantes. Un fallo de refresh conserva el credential
  record anterior y no genera tráfico outbound adicional.
- La nueva fila agrega metadata de ciclo de vida; las filas legacy quedan sin
  refresh automático hasta una nueva autorización OAuth válida.
- El maintenance timer vive en el proceso STAGING y es best-effort; un reinicio
  vuelve a ejecutar la validación viva en el arranque. PROD, Meta, WhatsApp,
  n8n y NETROOM permanecen fuera de alcance.
