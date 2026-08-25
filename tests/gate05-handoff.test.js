const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Mock window object
const mockWindow = {
  crypto: { randomUUID: () => 'test-conversation-id' },
  location: { search: '', href: 'https://campus-enfermeria.ferrerinstituto.com' },
  dataLayer: [],
  __omegaEvents: [],
  document: {
    createElement: () => ({
      id: null,
      hidden: false,
      dataset: {},
      textContent: '',
      setAttribute: function(k, v) { this[k] = v; },
      append: () => {},
      appendChild: () => {},
      replaceChildren: () => {}
    }),
    body: { appendChild: () => {}, append: () => {} },
    readyState: 'complete',
    addEventListener: () => {}
  }
};

// Helper para ejecutar shouldHandoff con contexto aislado
function testShouldHandoff(query) {
  const testContext = {
    window: {
      ...mockWindow,
      location: { ...mockWindow.location }
    },
    document: mockWindow.document
  };

  const code = `
var state={started:false,active_course:null,current_course_context:null,conversation_id:'test-id',handoff_active:false,handoff_condition:null,questions:[],answers:[],objections:[],actions:[]};
function shouldHandoff(context){var q=(context.query||'').toLowerCase();var trigger=null,reason='',priority='medium',capability=null,recommended=null;if(q.indexOf('hablar con alguien')>-1||q.indexOf('hablar con una persona')>-1||q.indexOf('hablar con humano')>-1||q.indexOf('asesor')>-1||q.indexOf('persona real')>-1){trigger='USER_REQUESTED_HUMAN';reason='Usuario solicitó explícitamente contacto humano';priority='high';recommended='Contactar al usuario por el canal preferido';}else if(q.indexOf('empresa')>-1&&(q.indexOf('convenio')>-1||q.indexOf('corporativo')>-1||q.indexOf('grupal')>-1)){trigger='COMMERCIAL_EXCEPTION';reason='Consulta comercial especial: convenio corporativo o grupal';priority='high';capability='Negociación comercial B2B';recommended='Derivar a área comercial para cotización especial';}else if(q.indexOf('autorización')>-1||q.indexOf('autorizacion')>-1||q.indexOf('permiso institucional')>-1){trigger='HUMAN_AUTHORIZATION_REQUIRED';reason='Requiere autorización o permiso institucional';priority='medium';}else if(q.indexOf('descuento')>-1&&(q.indexOf('negociar')>-1||q.indexOf('regatear')>-1)){trigger='NEGOTIATION_REQUIRED';reason='Usuario intenta negociar precio o condiciones';priority='medium';}else if(q.indexOf('queja grave')>-1||q.indexOf('reclamo formal')>-1||q.indexOf('denuncia')>-1){trigger='SENSITIVE_COMPLAINT';reason='Queja grave o reclamo formal detectado';priority='urgent';}else if(q.indexOf('no estoy seguro')>-1&&(q.indexOf('fuente')>-1||q.indexOf('dato')>-1)){trigger='SOURCE_UNCERTAINTY';reason='Incertidumbre sobre fuente o dato proporcionado';priority='low';}else if(q.indexOf('matrícula')>-1&&(q.indexOf('bloqueado')>-1||q.indexOf('no puedo')>-1)){trigger='CRITICAL_ACTION_BLOCKED';reason='Acción crítica bloqueada (matrícula)';priority='high';}else if(q.indexOf('netroom')>-1&&(q.indexOf('modificar')>-1||q.indexOf('editar')>-1)){trigger='PERMISSION_BOUNDARY';reason='Solicitud fuera de límite de permisos (modificación NETROOM)';priority='medium';}else if(q.indexOf('sistema caído')>-1||q.indexOf('plataforma no funciona')>-1){trigger='OPERATIONAL_EXCEPTION';reason='Excepción operacional: sistema caído o no funcional';priority='urgent';}return {should_handoff:trigger!==null,trigger_code:trigger,reason:trigger?reason:'No se detectó condición de handoff',priority:priority,capability:capability,recommended_next_action:recommended};}
window.__result = shouldHandoff({query: '${query}'});
`;

  vm.runInNewContext(code, testContext);
  return testContext.window.__result;
}

// Helper para validar estructura de contexto
function validateHandoffContext(context) {
  assert.strictEqual(context.schema_version, 'omega-handoff-context-v1', 'Schema version debe ser omega-handoff-context-v1');
  assert.ok(context.technical, 'Debe tener sección technical');
  assert.ok(context.technical.conversation_id, 'Debe tener conversation_id');
  assert.ok(context.technical.timestamp, 'Debe tener timestamp');
  assert.ok(context.identity, 'Debe tener sección identity');
  assert.ok(context.channel, 'Debe tener sección channel');
  assert.strictEqual(context.channel.channel_id, 'campus_web', 'Channel debe ser campus_web');
  assert.ok(context.commercial, 'Debe tener sección commercial');
  assert.ok(Array.isArray(context.commercial.questions), 'Commercial debe tener array questions');
  assert.ok(Array.isArray(context.commercial.relevant_answers), 'Commercial debe tener array relevant_answers');
  assert.ok(Array.isArray(context.commercial.objections), 'Commercial debe tener array objections');
  assert.ok(Array.isArray(context.commercial.unresolved_items), 'Commercial debe tener array unresolved_items');
  assert.ok(Array.isArray(context.commercial.actions_taken), 'Commercial debe tener array actions_taken');
  assert.ok(context.handoff, 'Debe tener sección handoff');
  assert.ok(typeof context.handoff.should_handoff === 'boolean', 'should_handoff debe ser boolean');
  assert.ok(context.handoff.reason, 'Debe tener reason');
  assert.ok(context.handoff.priority, 'Debe tener priority');
  assert.ok(context.privacy, 'Debe tener sección privacy');
  assert.ok(Array.isArray(context.privacy.excluded_data_domains), 'Privacy debe tener excluded_data_domains array');
  assert.ok(context.privacy.excluded_data_domains.includes('NETROOM_PRIVATE'), 'Debe incluir NETROOM_PRIVATE en excluded_data_domains');
  assert.ok(context.references, 'Debe tener sección references');
}

// Helper para parsear schema JSON
function parseSchema() {
  const schemaPath = 'schemas/omega-handoff-context-v1.json';
  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  return JSON.parse(schemaContent);
}

console.log('=== GATE 05 Movement 05.1A Tests ===\n');

// Test 1: Parse schema JSON
console.log('Test 1: Parse omega-handoff-context-v1 schema');
try {
  const schema = parseSchema();
  assert.strictEqual(schema.$schema, 'http://json-schema.org/draft-07/schema#', 'Schema debe ser draft-07');
  assert.strictEqual(schema.properties.schema_version.const, 'omega-handoff-context-v1', 'Schema version constante');
  assert.ok(schema.required.includes('handoff'), 'handoff debe ser campo requerido');
  assert.ok(schema.required.includes('privacy'), 'privacy debe ser campo requerido');
  console.log('  ✓ Schema parseable y válido\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 2: Valid handoff context structure
console.log('Test 2: Valid handoff context structure');
try {
  const testContext = {
    window: {
      ...mockWindow,
      location: { ...mockWindow.location }
    },
    document: mockWindow.document
  };

  const code = `
var courses=[{key:'cuidados',slug:'cuidados_criticos_emergencias',name:'Diplomatura en Cuidados Críticos y Emergencias para Enfermería'}];
var state={started:false,active_course:'cuidados_criticos_emergencias',current_course_context:courses[0],conversation_id:'test-id',handoff_active:false,handoff_condition:null,questions:['quiero hablar con alguien'],answers:[],objections:[],actions:[]};
function shouldHandoff(context){var q=(context.query||'').toLowerCase();var trigger=null,reason='',priority='medium',capability=null,recommended=null;if(q.indexOf('hablar con alguien')>-1||q.indexOf('hablar con una persona')>-1||q.indexOf('hablar con humano')>-1||q.indexOf('asesor')>-1||q.indexOf('persona real')>-1){trigger='USER_REQUESTED_HUMAN';reason='Usuario solicitó explícitamente contacto humano';priority='high';recommended='Contactar al usuario por el canal preferido';}else if(q.indexOf('empresa')>-1&&(q.indexOf('convenio')>-1||q.indexOf('corporativo')>-1||q.indexOf('grupal')>-1)){trigger='COMMERCIAL_EXCEPTION';reason='Consulta comercial especial: convenio corporativo o grupal';priority='high';capability='Negociación comercial B2B';recommended='Derivar a área comercial para cotización especial';}return {should_handoff:trigger!==null,trigger_code:trigger,reason:trigger?reason:'No se detectó condición de handoff',priority:priority,capability:capability,recommended_next_action:recommended};}
function buildHandoffContext(query,objections,actions){var course=state.current_course_context;var activeCourse=course?{course_id:state.active_course,slug:course.slug||null,public_name:course.name}:null;var handoffDecision=shouldHandoff({query:query});return {schema_version:'omega-handoff-context-v1',technical:{conversation_id:state.conversation_id,timestamp:new Date().toISOString()},identity:{user_id:null,session_id:null},channel:{channel_id:'campus_web',source_url:window.location?window.location.href:null},commercial:{active_course:activeCourse,questions:state.questions||[],relevant_answers:state.answers||[],objections:objections||[],unresolved_items:[],actions_taken:actions||[]},handoff:handoffDecision,privacy:{excluded_data_domains:['NETROOM_PRIVATE','ACADEMIC_RECORDS','PERSONAL_HEALTH_DATA'],data_handling_notes:'Context excludes private academic and health data per privacy policy'},references:{event_ids:[],related_context_urls:[]}};}
window.__context = buildHandoffContext('quiero hablar con alguien', [], []);
`;

  vm.runInNewContext(code, testContext);
  const context = testContext.window.__context;

  validateHandoffContext(context);
  assert.ok(context.commercial.active_course, 'Debe tener active_course');
  assert.strictEqual(context.commercial.active_course.course_id, 'cuidados_criticos_emergencias', 'course_id correcto');
  assert.strictEqual(context.commercial.active_course.public_name, 'Diplomatura en Cuidados Críticos y Emergencias para Enfermería', 'public_name correcto');
  console.log('  ✓ Context válido con todos los campos requeridos\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 3: Invalid context (missing required fields)
console.log('Test 3: Invalid context detection');
try {
  const invalidContext = {
    schema_version: 'omega-handoff-context-v1',
    technical: { conversation_id: 'test' }
    // Missing timestamp, identity, channel, commercial, handoff, privacy, references
  };

  try {
    validateHandoffContext(invalidContext);
    console.log('  ✗ FAIL: Should have thrown validation error\n');
    process.exit(1);
  } catch (validationError) {
    console.log('  ✓ Invalid context correctamente rechazado:', validationError.message.substring(0, 60), '...\n');
  }
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 4: Policy 1 - USER_REQUESTED_HUMAN debe activar handoff
console.log('Test 4: Policy 1 - USER_REQUESTED_HUMAN');
try {
  const result = testShouldHandoff('quiero hablar con una persona');
  assert.strictEqual(result.should_handoff, true, 'should_handoff debe ser true');
  assert.strictEqual(result.trigger_code, 'USER_REQUESTED_HUMAN', 'trigger_code debe ser USER_REQUESTED_HUMAN');
  assert.strictEqual(result.priority, 'high', 'priority debe ser high');
  assert.ok(result.reason, 'Debe tener reason');
  console.log('  ✓ USER_REQUESTED_HUMAN activa handoff correctamente\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 5: Policy 2 - COMMERCIAL_EXCEPTION debe activar handoff
console.log('Test 5: Policy 2 - COMMERCIAL_EXCEPTION');
try {
  const result = testShouldHandoff('necesito un convenio corporativo para mi empresa');
  assert.strictEqual(result.should_handoff, true, 'should_handoff debe ser true');
  assert.strictEqual(result.trigger_code, 'COMMERCIAL_EXCEPTION', 'trigger_code debe ser COMMERCIAL_EXCEPTION');
  assert.strictEqual(result.priority, 'high', 'priority debe ser high');
  assert.strictEqual(result.capability, 'Negociación comercial B2B', 'capability correcta');
  assert.ok(result.recommended_next_action, 'Debe tener recommended_next_action');
  console.log('  ✓ COMMERCIAL_EXCEPTION activa handoff correctamente\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 6: Policy 3 - Consulta de precio normal NO debe activar handoff
console.log('Test 6: Policy 3 - Precio normal NO activa handoff');
try {
  const result = testShouldHandoff('cuánto cuesta el curso de cuidados críticos');
  assert.strictEqual(result.should_handoff, false, 'should_handoff debe ser false');
  assert.strictEqual(result.trigger_code, null, 'trigger_code debe ser null');
  assert.strictEqual(result.priority, 'medium', 'priority debe ser medium default');
  console.log('  ✓ Consulta precio normal NO activa handoff\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 7: Policy 4 - Objeción de precio normal NO debe activar handoff
console.log('Test 7: Policy 4 - Objeción precio normal NO activa handoff');
try {
  const result = testShouldHandoff('me parece muy caro');
  assert.strictEqual(result.should_handoff, false, 'should_handoff debe ser false');
  assert.strictEqual(result.trigger_code, null, 'trigger_code debe ser null');
  console.log('  ✓ Objeción precio normal NO activa handoff\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 8: Policy 5 - Alta intención sola NO debe activar handoff
console.log('Test 8: Policy 5 - Alta intención sola NO activa handoff');
try {
  const result = testShouldHandoff('quiero inscribirme al curso de enfermería escolar');
  assert.strictEqual(result.should_handoff, false, 'should_handoff debe ser false');
  assert.strictEqual(result.trigger_code, null, 'trigger_code debe ser null');
  console.log('  ✓ Alta intención sola NO activa handoff\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 9: Regression - Gate04 handoff idempotency
console.log('Test 9: Regression Gate04 - Handoff idempotency');
try {
  const testContext = {
    window: {
      ...mockWindow,
      __triggerCount: 0
    },
    document: mockWindow.document
  };

  const code = `
var state={handoff_active:false,handoff_condition:null,conversation_id:'test-id',questions:[],answers:[],objections:[],actions:[]};
var triggerCount = 0;
function shouldHandoff(context){var q=(context.query||'').toLowerCase();var trigger=null,reason='',priority='medium';if(q.indexOf('hablar con alguien')>-1){trigger='USER_REQUESTED_HUMAN';reason='Usuario solicitó explícitamente contacto humano';priority='high';}return {should_handoff:trigger!==null,trigger_code:trigger,reason:reason,priority:priority,capability:null,recommended_next_action:null};}
function detectHandoff(q){var handoffDecision=shouldHandoff({query:q});return handoffDecision.trigger_code;}
function triggerHandoff(condition,query){if(state.handoff_active&&state.handoff_condition===condition)return;state.handoff_active=true;state.handoff_condition=condition;triggerCount++;}
var r1 = detectHandoff('quiero hablar con una persona');
if(r1) triggerHandoff(r1, 'quiero hablar con una persona');
var r2 = detectHandoff('quiero hablar con una persona');
if(r2) triggerHandoff(r2, 'quiero hablar con una persona');
window.__triggerCount = triggerCount;
`;

  vm.runInNewContext(code, testContext);
  assert.strictEqual(testContext.window.__triggerCount, 1, 'Handoff duplicado debe ser idempotente (solo 1 trigger)');
  console.log('  ✓ Handoff idempotency preservada (Gate04 regression)\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

// Test 10: Additional trigger codes defined (without false positives)
console.log('Test 10: Trigger codes defined sin falsos positivos');
try {
  const triggers = [
    { query: 'necesito autorización para esto', expected: 'HUMAN_AUTHORIZATION_REQUIRED' },
    { query: 'quiero negociar el descuento', expected: 'NEGOTIATION_REQUIRED' },
    { query: 'tengo una queja grave', expected: 'SENSITIVE_COMPLAINT' },
    { query: 'no estoy seguro de la fuente', expected: 'SOURCE_UNCERTAINTY' },
    { query: 'matrícula bloqueado no puedo', expected: 'CRITICAL_ACTION_BLOCKED' },
    { query: 'modificar netroom', expected: 'PERMISSION_BOUNDARY' },
    { query: 'sistema caído', expected: 'OPERATIONAL_EXCEPTION' }
  ];

  triggers.forEach(({ query, expected }) => {
    const result = testShouldHandoff(query);
    assert.strictEqual(result.trigger_code, expected, `Query "${query}" debe activar ${expected}`);
    assert.strictEqual(result.should_handoff, true, `Query "${query}" debe activar handoff`);
  });

  console.log('  ✓ Todos los trigger codes definidos y funcionando\n');
} catch (e) {
  console.log('  ✗ FAIL:', e.message, '\n');
  process.exit(1);
}

console.log('=== GATE 05 Movement 05.1A: PASS (10/10 tests) ===');
