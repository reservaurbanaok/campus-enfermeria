# Gate 09 — Metric dictionary V1

Todas las métricas usan la ventana, canal, curso y timezone seleccionados.
`omega-events-v1` es la fuente; si la fuente o el denominador no tienen
cobertura, el resultado es `NO_DATA`.

## Adquisición

### CONVERSATIONS_TOTAL

- NAME: `conversations_total`
- DEFINITION: conversaciones distintas con al menos un evento almacenado.
- NUMERATOR: `COUNT(DISTINCT conversation_id)`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: cualquier evento con `conversation_id`.
- FILTERS: ventana, canal.
- LIMITATIONS: no reconstruye conversaciones anteriores al Event Store.

### UNIQUE_CONVERSATIONS_PER_DAY

- NAME: `unique_conversations_per_day`
- DEFINITION: pares distintos de día local y conversación.
- NUMERATOR: `COUNT(DISTINCT local_day + conversation_id)`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: cualquier evento con `conversation_id` y timestamp.
- FILTERS: ventana, canal, timezone operativo.
- LIMITATIONS: no equivale a personas únicas.

### COURSE_ASKED_BY_COURSE

- NAME: `course_asked_by_course`
- DEFINITION: cantidad de consultas por curso conocido.
- NUMERATOR: eventos `course_asked` agrupados por `course_id`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: `course_asked`.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: cursos sin `course_id` quedan fuera del ranking.

## Intención

### INTENT_DETECTED

- NAME: `intent_detected`
- DEFINITION: eventos de intención detectada.
- NUMERATOR: `COUNT(intent_detected)`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: `intent_detected`.
- FILTERS: ventana, canal.
- LIMITATIONS: cuenta eventos, no personas.

### INTENT_RATE

- NAME: `intent_rate`
- DEFINITION: conversaciones con intención sobre conversaciones iniciadas.
- NUMERATOR: conversaciones distintas con `intent_detected`.
- DENOMINATOR: conversaciones distintas con `conversation_started`.
- SOURCE_EVENTS: `intent_detected`, `conversation_started`.
- FILTERS: ventana, canal.
- LIMITATIONS: sin `conversation_started` durable no se calcula.

### PROFILE_QUALIFIED

- NAME: `profile_qualified`
- DEFINITION: perfiles calificados registrados por OMEGA.
- NUMERATOR: `COUNT(profile_qualified)`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: `profile_qualified`.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: no infiere calificación desde texto.

### HIGH_INTENT_SIGNALS

- NAME: `high_intent_signals`
- DEFINITION: señales comerciales de alta intención disponibles.
- NUMERATOR: conteo por `enrollment_intent_detected`,
  `recommendation_accepted` y `enrollment_started`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: los tres eventos anteriores.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: cada señal se reporta por separado.

## Interés comercial

Para cada entrada, el contrato es el mismo: `NUMERATOR` es el conteo del
evento indicado; no hay denominador; los filtros son ventana, canal y curso.

| NAME | DEFINITION | SOURCE_EVENTS | LIMITATIONS |
|---|---|---|---|
| `price_asked` | consultas de precio | `price_asked` | no guarda el texto consultado |
| `certification_asked` | consultas de certificación | `certification_asked` | no evalúa satisfacción |
| `modality_asked` | consultas de modalidad | `modality_asked` | requiere emisión del evento |
| `duration_asked` | consultas de duración | `duration_asked` | requiere emisión del evento |
| `requirement_asked` | consultas de requisitos | `requirement_asked` | requiere emisión del evento |

## Recomendaciones

### RECOMMENDATIONS

- NAME: `recommendations`
- DEFINITION: recomendaciones producidas por OMEGA.
- NUMERATOR: `COUNT(course_recommended)`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: `course_recommended`.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: no implica aceptación.

### RECOMMENDATION_ACCEPTANCE_RATE

- NAME: `recommendation_acceptance_rate`
- DEFINITION: aceptaciones sobre recomendaciones.
- NUMERATOR: `COUNT(recommendation_accepted)`.
- DENOMINATOR: `COUNT(course_recommended)`.
- SOURCE_EVENTS: `recommendation_accepted`, `course_recommended`.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: se muestra `NO_DATA` si no hay recomendaciones.

## Objeciones y handoffs

### OBJECTIONS_DETECTED

- NAME: `objections_detected`
- DEFINITION: objeciones detectadas, sin guardar el mensaje.
- NUMERATOR: `COUNT(objection_detected)`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: `objection_detected`.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: categorías sólo cuando el emisor las provee.

### OBJECTION_RESOLUTION_RATE

- NAME: `objection_resolution_rate`
- DEFINITION: objeciones resueltas sobre objeciones detectadas.
- NUMERATOR: `COUNT(objection_resolved)`.
- DENOMINATOR: `COUNT(objection_detected)`.
- SOURCE_EVENTS: `objection_resolved`, `objection_detected`.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: no se infiere resolución por el contenido de una respuesta.

### HANDOFFS

- NAME: `handoffs`
- DEFINITION: derivaciones humanas creadas.
- NUMERATOR: `COUNT(handoff_created)`.
- DENOMINATOR: no aplica.
- SOURCE_EVENTS: `handoff_created`.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: no es una medición de conversión.

## Funnel

Cada etapa se define como conversaciones distintas que emitieron el evento,
con la etapa anterior como referencia descriptiva y sin inventar eventos
ausentes:

| NAME | DEFINITION | NUMERATOR | DENOMINATOR | SOURCE_EVENTS | FILTERS | LIMITATIONS |
|---|---|---|---|---|---|---|
| `funnel_conversation_started` | conversaciones iniciadas | distinct conversations | no aplica | `conversation_started` | ventana, canal | cobertura depende de captura |
| `funnel_course_recommended` | conversaciones recomendadas | distinct conversations | etapa anterior sólo para comparación | `course_recommended` | ventana, canal, curso | no calcula conversión si falta etapa |
| `funnel_enrollment_link_sent` | enlaces enviados | distinct conversations | etapa anterior | `enrollment_link_sent` | ventana, canal, curso | no confunde apertura con inscripción |
| `funnel_enrollment_started` | inscripciones iniciadas | distinct conversations | etapa anterior | `enrollment_started` | ventana, canal, curso | requiere evento durable |
| `funnel_enrollment_completed` | inscripciones completadas | distinct conversations | etapa anterior | `enrollment_completed` | ventana, canal, curso | no se fabrica desde pagos/alumnos |

## Calidad de datos

### EVENT_DATA_QUALITY

- NAME: `event_data_quality`
- DEFINITION: controles de duplicados, nulos requeridos, tipos, canales,
  schema, timestamps y coberturas de curso/conversación.
- NUMERATOR: cantidad de filas con la condición evaluada.
- DENOMINATOR: filas leídas en el rango.
- SOURCE_EVENTS: todas las filas del Event Store.
- FILTERS: ventana, canal, curso.
- LIMITATIONS: estado vacío válido no equivale a evidencia comercial.
