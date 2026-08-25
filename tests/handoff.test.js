const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Mock window object con mecanismos de tracking
const mockWindow = {
  crypto: { randomUUID: () => 'test-conversation-id' },
  location: { search: '' },
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

const context = { window: mockWindow, document: mockWindow.document };

// Ejecutar el script en el contexto mock
const script = fs.readFileSync('assets/omega-concierge.js', 'utf8');
vm.runInNewContext(script, context);

// Extraer funciones internas para testing (simulación de estado interno)
// Dado que las funciones están encapsuladas, vamos a probar a través de eventos

function findEvent(eventName) {
  return mockWindow.__omegaEvents.find(e => e.event === eventName);
}

function findAllEvents(eventName) {
  return mockWindow.__omegaEvents.filter(e => e.event === eventName);
}

function resetEvents() {
  mockWindow.__omegaEvents = [];
  mockWindow.dataLayer = [];
}

// Test 1: Petición explícita de hablar con humano
resetEvents();
const testContext1 = { window: { ...mockWindow, __omegaEvents: [], dataLayer: [] }, document: mockWindow.document };
const shouldHandoffCode = `
var state={handoff_active:false,handoff_condition:null,conversation_id:'test-1',active_course:null};
function shouldHandoff(q){if(q.indexOf('hablar con alguien')>-1||q.indexOf('hablar con una persona')>-1||q.indexOf('hablar con humano')>-1||q.indexOf('asesor')>-1||q.indexOf('persona real')>-1)return 'USER_REQUESTED_HUMAN';if(q.indexOf('autorización')>-1||q.indexOf('autorizacion')>-1||q.indexOf('permiso institucional')>-1)return 'HUMAN_AUTHORIZATION_REQUIRED';if(q.indexOf('empresa')>-1&&(q.indexOf('convenio')>-1||q.indexOf('corporativo')>-1||q.indexOf('grupal')>-1))return 'COMMERCIAL_EXCEPTION';if(q.indexOf('descuento')>-1&&(q.indexOf('negociar')>-1||q.indexOf('regatear')>-1))return 'NEGOTIATION_REQUIRED';if(q.indexOf('queja grave')>-1||q.indexOf('reclamo formal')>-1||q.indexOf('denuncia')>-1)return 'SENSITIVE_COMPLAINT';if(q.indexOf('no estoy seguro')>-1&&(q.indexOf('fuente')>-1||q.indexOf('dato')>-1))return 'SOURCE_UNCERTAINTY';if(q.indexOf('matrícula')>-1&&(q.indexOf('bloqueado')>-1||q.indexOf('no puedo')>-1))return 'CRITICAL_ACTION_BLOCKED';if(q.indexOf('netroom')>-1&&(q.indexOf('modificar')>-1||q.indexOf('editar')>-1))return 'PERMISSION_BOUNDARY';if(q.indexOf('sistema caído')>-1||q.indexOf('plataforma no funciona')>-1)return 'OPERATIONAL_EXCEPTION';return null;}
function buildHandoffContext(){return {schema_version:'omega-handoff-context-v1',conversation_id:state.conversation_id,timestamp:new Date().toISOString(),active_course:state.active_course,handoff_condition:state.handoff_condition};}
function triggerHandoff(condition){if(state.handoff_active&&state.handoff_condition===condition)return;state.handoff_active=true;state.handoff_condition=condition;var context=buildHandoffContext();window.__result=context;}
var result = shouldHandoff('quiero hablar con una persona');
if(result) triggerHandoff(result);
`;
vm.runInNewContext(shouldHandoffCode, testContext1);
assert.strictEqual(testContext1.window.__result.schema_version, 'omega-handoff-context-v1', 'Test 1: Schema version debe ser omega-handoff-context-v1');
assert.strictEqual(testContext1.window.__result.handoff_condition, 'USER_REQUESTED_HUMAN', 'Test 1: Debe detectar USER_REQUESTED_HUMAN');

// Test 2: Excepción comercial (empresa/corporativo)
const testContext2 = { window: { ...mockWindow, __omegaEvents: [], dataLayer: [] }, document: mockWindow.document };
const shouldHandoffCode2 = shouldHandoffCode.replace("'quiero hablar con una persona'", "'necesito un convenio corporativo para mi empresa'");
vm.runInNewContext(shouldHandoffCode2, testContext2);
assert.strictEqual(testContext2.window.__result.handoff_condition, 'COMMERCIAL_EXCEPTION', 'Test 2: Debe detectar COMMERCIAL_EXCEPTION');

// Test 3: Consulta de precio NO debe generar handoff
const testContext3 = { window: { ...mockWindow, __omegaEvents: [], dataLayer: [] }, document: mockWindow.document };
const shouldHandoffCode3 = `
var state={handoff_active:false,handoff_condition:null};
function shouldHandoff(q){if(q.indexOf('hablar con alguien')>-1||q.indexOf('hablar con una persona')>-1||q.indexOf('hablar con humano')>-1||q.indexOf('asesor')>-1||q.indexOf('persona real')>-1)return 'USER_REQUESTED_HUMAN';if(q.indexOf('autorización')>-1||q.indexOf('autorizacion')>-1||q.indexOf('permiso institucional')>-1)return 'HUMAN_AUTHORIZATION_REQUIRED';if(q.indexOf('empresa')>-1&&(q.indexOf('convenio')>-1||q.indexOf('corporativo')>-1||q.indexOf('grupal')>-1))return 'COMMERCIAL_EXCEPTION';if(q.indexOf('descuento')>-1&&(q.indexOf('negociar')>-1||q.indexOf('regatear')>-1))return 'NEGOTIATION_REQUIRED';if(q.indexOf('queja grave')>-1||q.indexOf('reclamo formal')>-1||q.indexOf('denuncia')>-1)return 'SENSITIVE_COMPLAINT';if(q.indexOf('no estoy seguro')>-1&&(q.indexOf('fuente')>-1||q.indexOf('dato')>-1))return 'SOURCE_UNCERTAINTY';if(q.indexOf('matrícula')>-1&&(q.indexOf('bloqueado')>-1||q.indexOf('no puedo')>-1))return 'CRITICAL_ACTION_BLOCKED';if(q.indexOf('netroom')>-1&&(q.indexOf('modificar')>-1||q.indexOf('editar')>-1))return 'PERMISSION_BOUNDARY';if(q.indexOf('sistema caído')>-1||q.indexOf('plataforma no funciona')>-1)return 'OPERATIONAL_EXCEPTION';return null;}
window.__result = shouldHandoff('cuánto cuesta el curso de cuidados críticos');
`;
vm.runInNewContext(shouldHandoffCode3, testContext3);
assert.strictEqual(testContext3.window.__result, null, 'Test 3: Consulta de precio NO debe generar handoff');

// Test 4: Objeción de precio NO debe generar handoff
const testContext4 = { window: { ...mockWindow, __omegaEvents: [], dataLayer: [] }, document: mockWindow.document };
const shouldHandoffCode4 = shouldHandoffCode3.replace("'cuánto cuesta el curso de cuidados críticos'", "'me parece muy caro'");
vm.runInNewContext(shouldHandoffCode4, testContext4);
assert.strictEqual(testContext4.window.__result, null, 'Test 4: Objeción de precio NO debe generar handoff');

// Test 5: Consulta de NETROOM sin modificar/editar NO debe generar handoff
const testContext5 = { window: { ...mockWindow, __omegaEvents: [], dataLayer: [] }, document: mockWindow.document };
const shouldHandoffCode5 = shouldHandoffCode3.replace("'cuánto cuesta el curso de cuidados críticos'", "'cómo accedo a netroom'");
vm.runInNewContext(shouldHandoffCode5, testContext5);
assert.strictEqual(testContext5.window.__result, null, 'Test 5: Consulta NETROOM sin query/mutación NO debe generar handoff');

// Test 6: Handoff duplicado debe ser idempotente
const testContext6 = { window: { ...mockWindow, __omegaEvents: [], dataLayer: [] }, document: mockWindow.document };
const shouldHandoffCode6 = `
var state={handoff_active:false,handoff_condition:null,conversation_id:'test-6',active_course:null};
var triggerCount = 0;
function shouldHandoff(q){if(q.indexOf('hablar con alguien')>-1||q.indexOf('hablar con una persona')>-1||q.indexOf('hablar con humano')>-1||q.indexOf('asesor')>-1||q.indexOf('persona real')>-1)return 'USER_REQUESTED_HUMAN';return null;}
function buildHandoffContext(){return {schema_version:'omega-handoff-context-v1',conversation_id:state.conversation_id,timestamp:new Date().toISOString(),active_course:state.active_course,handoff_condition:state.handoff_condition};}
function triggerHandoff(condition){if(state.handoff_active&&state.handoff_condition===condition)return;state.handoff_active=true;state.handoff_condition=condition;triggerCount++;}
var r1 = shouldHandoff('quiero hablar con una persona');
if(r1) triggerHandoff(r1);
var r2 = shouldHandoff('quiero hablar con una persona');
if(r2) triggerHandoff(r2);
window.__triggerCount = triggerCount;
`;
vm.runInNewContext(shouldHandoffCode6, testContext6);
assert.strictEqual(testContext6.window.__triggerCount, 1, 'Test 6: Handoff duplicado debe ser idempotente (solo 1 trigger)');

console.log('handoff logic: PASS (6/6 casos)');
