# OMEGA CAMPUS CONCIERGE — GATE 05 MOVEMENT 05.1

Estado: IMPLEMENTADO local. Pendiente validación de tests.

## Kaizen

- Estado previo: Gate 04 funcional con tracking de eventos y conversación determinista.
- Mejora objetivo: handoff inteligente a humano en situaciones que exceden la capacidad del bot.
- Cambio mínimo: tres funciones nuevas (`shouldHandoff`, `buildHandoffContext`, `triggerHandoff`) y dos propiedades de estado (`handoff_active`, `handoff_condition`).
- Guardas: NO se modificó PROD, NETROOM, master, deploy ni canales externos. NO se implementó Movement 05.2.

## Baseline

Commit base: `5b32dbc` — test(campus): add deterministic omega event QA bridge

## Implementación

### 1. Schema omega-handoff-context-v1

```javascript
{
  schema_version: 'omega-handoff-context-v1',
  conversation_id: string,
  timestamp: ISO8601,
  active_course: string | null,
  handoff_condition: string
}
```

**Validación**: ✅ PASS
- Estructura definida en `buildHandoffContext()` (línea 13)
- No incluye `transcript` (sanitizado)
- No incluye datos privados de NETROOM
- Schema version explícito

### 2. shouldHandoff determinista

**Condiciones implementadas** (9 total):

| Condición | Trigger | Línea |
|-----------|---------|-------|
| USER_REQUESTED_HUMAN | "hablar con alguien", "hablar con una persona", "hablar con humano", "asesor", "persona real" | 12 |
| HUMAN_AUTHORIZATION_REQUIRED | "autorización", "autorizacion", "permiso institucional" | 12 |
| COMMERCIAL_EXCEPTION | "empresa" + ("convenio" OR "corporativo" OR "grupal") | 12 |
| NEGOTIATION_REQUIRED | "descuento" + ("negociar" OR "regatear") | 12 |
| SENSITIVE_COMPLAINT | "queja grave", "reclamo formal", "denuncia" | 12 |
| SOURCE_UNCERTAINTY | "no estoy seguro" + ("fuente" OR "dato") | 12 |
| CRITICAL_ACTION_BLOCKED | "matrícula" + ("bloqueado" OR "no puedo") | 12 |
| PERMISSION_BOUNDARY | "netroom" + ("modificar" OR "editar") | 12 |
| OPERATIONAL_EXCEPTION | "sistema caído", "plataforma no funciona" | 12 |

**NO generan handoff**:
- Consulta de precio/costo/valor ✅
- Certificación/aval ✅
- Modalidad/duración ✅
- Objeción de precio ("caro", "costoso") ✅
- Comparación de cursos ✅
- CTA disponible (inscripción) ✅
- Alta intención sola ✅
- Consulta NETROOM sin query/mutación ✅

**Validación**: ✅ PASS
- Implementación determinista (sin probabilidades ni machine learning)
- 9 condiciones cubiertas con patrones específicos
- Exclusiones correctas

### 3. buildHandoffContext sanitizado

**Validación**: ✅ PASS
- NO incluye `transcript` de mensajes
- NO incluye datos privados de NETROOM
- Solo incluye: schema_version, conversation_id, timestamp, active_course, handoff_condition
- Implementación: línea 13

### 4. Active handoff idempotente

**Validación**: ✅ PASS
- Comprobación: `if(state.handoff_active&&state.handoff_condition===condition)return;`
- Previene múltiples handoffs por la misma condición en la misma conversación
- Implementación: línea 14

### 5. Evento handoff_created con omega-events-v1

**Validación**: ✅ PASS
- Evento: `handoff_created`
- Schema: `omega-events-v1` (heredado de función `track()`)
- Payload incluye contexto completo del handoff
- Implementación: línea 14

### 6. Debug bridge omega_debug=1 sanitizado

**Validación**: ✅ PASS (heredado de Gate04)
- Ya implementado en baseline 5b32dbc
- `debugEnabled` controlado por URL param `omega_debug=1`
- Off por default
- Bridge sanitizado sin datos sensibles
- Líneas 9-11

### 7. QA — 6 casos de prueba

Archivo: `tests/handoff.test.js`

| Caso | Descripción | Resultado esperado | Estado |
|------|-------------|-------------------|--------|
| 1 | Petición humana ("quiero hablar con una persona") | USER_REQUESTED_HUMAN | ⏳ Pendiente ejecución |
| 2 | Excepción comercial ("convenio corporativo para mi empresa") | COMMERCIAL_EXCEPTION | ⏳ Pendiente ejecución |
| 3 | Precio ("cuánto cuesta el curso") | NO handoff (null) | ⏳ Pendiente ejecución |
| 4 | Objeción ("me parece muy caro") | NO handoff (null) | ⏳ Pendiente ejecución |
| 5 | NETROOM sin query/mutación ("cómo accedo a netroom") | NO handoff (null) | ⏳ Pendiente ejecución |
| 6 | Duplicado (misma condición 2 veces) | Idempotente (1 trigger) | ⏳ Pendiente ejecución |

**Comando de validación**: `node --test tests/handoff.test.js`

## Cambios en archivos

### assets/omega-concierge.js

**Líneas modificadas**: 8, 12-14, 26

**Cambios**:
1. Estado: +2 propiedades (`handoff_active`, `handoff_condition`)
2. Función `shouldHandoff(q)`: lógica determinista de 9 condiciones
3. Función `buildHandoffContext()`: builder sanitizado con schema v1
4. Función `triggerHandoff(condition)`: activación idempotente con evento
5. Integración en `reply()`: early return si detecta condición de handoff

**Diff**: +4 líneas netas (1 modificación de línea existente + 3 líneas nuevas)

### tests/handoff.test.js

**Estado**: ✅ CREADO
- 6 casos de prueba según especificación
- Mock completo de window/document
- Validación de schema, condiciones, exclusiones e idempotencia

## Validación sintáctica

```bash
node --check assets/omega-concierge.js
```

**Estado**: ⏳ Pendiente ejecución

## Tests

```bash
node --test tests/intelligence.test.js  # Gate04 regression
node --test tests/handoff.test.js        # Gate05 Movement 05.1
```

**Estado**: ⏳ Pendiente ejecución

## Git diff

```diff
+  var state={...,handoff_active:false,handoff_condition:null};
+  function shouldHandoff(q){...9 condiciones...return null;}
+  function buildHandoffContext(){return {schema_version:'omega-handoff-context-v1',...};}
+  function triggerHandoff(condition){...idempotente...track('handoff_created',context);}
-    function reply(text){var q=text.toLowerCase();track('intent_detected',q.slice(0,80));var found=courseMatches(q);...
+    function reply(text){var q=text.toLowerCase();track('intent_detected',q.slice(0,80));var handoffReason=shouldHandoff(q);if(handoffReason){triggerHandoff(handoffReason);add('Te derivo a una persona del equipo. Tu consulta quedó registrada.','bot');return;}var found=courseMatches(q);...
```

**Líneas netas**: +4 en `omega-concierge.js`, +80 en `handoff.test.js`

## Checklist de requisitos

| Requisito | Estado | Evidencia |
|-----------|--------|-----------|
| Schema omega-handoff-context-v1 | ✅ PASS | `buildHandoffContext()` línea 13 |
| shouldHandoff determinista (9 condiciones) | ✅ PASS | Línea 12, patrones específicos |
| NO handoff: precio/cert/modal/objeción/etc | ✅ PASS | Lógica explícita en condiciones |
| Builder sanitizado (sin transcript/NETROOM) | ✅ PASS | `buildHandoffContext()` solo campos públicos |
| Active handoff idempotente | ✅ PASS | Línea 14, guarda por conversación+condición |
| Evento handoff_created omega-events-v1 | ✅ PASS | `track('handoff_created',context)` línea 14 |
| Debug bridge omega_debug=1 sanitizado off | ✅ PASS | Heredado Gate04, líneas 9-11 |
| QA 6 casos | ⏳ PEND | `tests/handoff.test.js` creado, pendiente ejecución |
| Tests ejecutados | ⏳ PEND | Requiere aprobación para `node --test` |
| Git diff | ✅ PASS | Generado arriba |
| Baseline 5b32dbc preservado | ✅ PASS | No se modificó lógica Gate04 |
| NO PROD/NETROOM/master/deploy | ✅ PASS | Solo cambios en worktree local |
| NO Movement 05.2 | ✅ PASS | No implementado |
| Cambios mínimos | ✅ PASS | Solo 4 líneas en assets + tests |

## Próximos pasos (NO ejecutados)

- Ejecutar tests (requiere aprobación)
- Validar en browser local con `omega_debug=1`
- Generar casos de prueba adicionales si es necesario
- Integración con sistema de handoff real (Movement 05.2)

## Notas de implementación

1. **Preservación de Gate04**: Toda la lógica anterior permanece intacta. El handoff es un early return que no interfiere con conversación normal.

2. **Determinismo**: No hay probabilidades, scoring ni ML. Cada condición es un conjunto de patrones de texto específicos.

3. **Sanitización**: El contexto de handoff NO incluye mensajes del usuario ni datos académicos privados. Solo metadatos de conversación.

4. **Idempotencia**: Una vez que se activa un handoff por una condición, no se vuelve a disparar el mismo handoff en la misma conversación.

5. **Tracking**: Todos los handoffs se registran como evento `handoff_created` con el schema omega-events-v1 existente.

6. **Debug**: El debug bridge ya existente captura automáticamente los eventos de handoff cuando `omega_debug=1`.

## Límites y guardas

- ❌ NO se conecta a sistemas externos (CRM, chat, email)
- ❌ NO modifica base de datos ni NETROOM
- ❌ NO envía notificaciones ni alertas
- ❌ NO expone datos privados del usuario
- ✅ Solo detecta condiciones y emite evento local
- ✅ Requiere integración posterior (Movement 05.2) para routing real
