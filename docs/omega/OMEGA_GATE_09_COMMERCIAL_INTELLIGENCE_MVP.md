# OMEGA Gate 09 — Commercial Intelligence MVP

## Alcance y estado

Gate 09 agrega una capa analítica aislada para STAGING. Consume eventos
canónicos existentes y no cambia la respuesta ni el contrato de WhatsApp,
Instagram, WF04, Gate 07 o Gate 08. PROD y NETROOM quedan fuera.

La primera frontera faltante fue `EVENT GENERATED → EVENT DURABLY STORED`.
Los eventos ya eran generados por OMEGA Core y devueltos por los ingress, pero
no existía un almacén durable para métricas. El MVP corrige sólo esa frontera
y agrega las tres capas de lectura necesarias.

## Arquitectura implementada

1. **EVENT STORE** — `public.omega_commercial_events` en la Neon ya usada por
   STAGING. La tabla se crea de forma idempotente, usa `event_id` como clave
   primaria y conserva `omega-events-v1`, timestamp, conversación, canal,
   curso, fuente, correlación y metadata sanitizada.
2. **METRIC ENGINE** —
   `api/_lib/commercial-event-store.js` consulta sólo el rango seleccionado y
   calcula adquisición, intención, interés comercial, recomendaciones,
   objeciones, handoffs, embudo y calidad.
3. **COMMERCIAL SENSOR** — produce `FACTS` medidos, `INTERPRETATION` explícita
   y `RECOMMENDATIONS` ligadas a evidencia. Sin denominador válido produce
   `NO_DATA` o `INSUFFICIENT_DATA`.
4. **READ-ONLY OPERATOR VIEW** —
   `/dashboard/commercial-intelligence` consume únicamente
   `GET /api/dashboard/commercial-intelligence`. No permite editar CRM,
   alumnos, cursos o progreso.

## Captura, idempotencia y privacidad

La captura se conecta al resultado del emisor canónico de WhatsApp STAGING e
Instagram STAGING mediante `captureCanonicalEvents`. Es no bloqueante: un
fallo de analítica no altera la respuesta del canal. `INSERT ... ON CONFLICT
DO NOTHING` evita duplicados. Se habilita explícitamente sólo en STAGING con
`OMEGA_COMMERCIAL_EVENT_STORE_ENABLED=true`; sin esa bandera los canales
congelados no adquieren efectos analíticos. No se reinyectan ni fabrican
eventos históricos.

Se conserva sólo metadata de baja sensibilidad. Se descartan cuerpos,
transcripciones, texto de mensajes, tokens, secretos, códigos, credenciales,
cookies, emails, teléfonos y nombres. Los identificadores de remitente se
guardan sólo como referencia `sha256:`; nunca se guarda el identificador
directo. El operador recibe agregados, no filas de eventos.

## Filtros y semántica

- Ventanas: `TODAY`, `LAST_7_DAYS`, `LAST_30_DAYS` y
  `CUSTOM_DATE_RANGE`.
- Zona horaria: `America/Argentina/Buenos_Aires`.
- Filtros adicionales: canal y curso cuando el evento tiene `course_id`.
- `MEASURED`: hay eventos y el valor se puede calcular.
- `ZERO`: hay datos en el conjunto, pero el conteo de esa métrica es cero.
- `NO_DATA`: no hay cobertura/eventos para calcular la métrica o no existe un
  denominador válido. Nunca se presenta como cero ni se calcula porcentaje.
- `INSUFFICIENT_DATA`: el Sensor no tiene evidencia suficiente para una
  interpretación o recomendación.

## Cobertura conocida

Los eventos anteriores al despliegue del Event Store no se reconstruyen. La
instrumentación cliente de `campus_web` continúa siendo `dataLayer`/
`__omegaEvents` en memoria; no se agrega un warehouse de transcripciones ni
un transporte que cambie el runtime web en este MVP. Por eso la vista puede
mostrar `VALID_EMPTY_STATE` aunque la tabla sea correcta. Las coberturas
faltantes se muestran como `NO_DATA` o `NOT_INSTRUMENTED_OR_NO_DATA`, nunca
como porcentajes falsos.

## Validación y regresiones

Los tests aislados usan datos sintéticos sólo en memoria. Cubren schema,
sanitización, deduplicación, tabla, filtros, denominadores, `NO_DATA`, Sensor
y API GET-only. No escriben en Neon STAGING. La validación de datos reales se
debe declarar `PASS` sólo cuando la vista lea eventos reales; en ausencia de
filas válidas el estado correcto es `VALID_EMPTY_STATE`.

No se mutan WhatsApp, WF04, Gate 07, Gate 08, PROD ni NETROOM.
