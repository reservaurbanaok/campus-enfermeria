(function(){
  'use strict';
  var state={conversation_id:(window.crypto&&crypto.randomUUID?crypto.randomUUID():'omega-'+Date.now()+'-'+Math.random().toString(36).slice(2)),started:false},debugEnabled=new URLSearchParams(window.location.search).get('omega_debug')==='1',debugEvents=[];
  function debugBridge(){if(!debugEnabled)return null;var bridge=document.getElementById('omega-event-debug');if(!bridge){bridge=document.createElement('div');bridge.id='omega-event-debug';bridge.hidden=true;bridge.dataset.eventCount='0';document.body.appendChild(bridge);}return bridge;}
  function track(name,detail){var payload={event:name,timestamp:new Date().toISOString(),channel:'campus_web',schema_version:'omega-events-v1',conversation_id:state.conversation_id,course_id:state.active_course||undefined,detail:detail||undefined};window.dataLayer=window.dataLayer||[];window.dataLayer.push(payload);var events=Array.isArray(window.__omegaEvents)?window.__omegaEvents:[];window.__omegaEvents=events;events.push(payload);var bridge=debugBridge();if(bridge){debugEvents.push({event:payload.event,timestamp:payload.timestamp,channel:payload.channel,schema_version:payload.schema_version,conversation_id:payload.conversation_id,course_id:payload.course_id||null,detail:payload.detail||null});bridge.dataset.eventCount=String(debugEvents.length);bridge.dataset.lastEvent=payload.event;bridge.textContent=JSON.stringify({count:debugEvents.length,events:debugEvents});}}
  function publishHandoffDebug(context,decision){var bridge=debugBridge();if(!bridge)return;bridge.dataset.handoffActive='true';bridge.dataset.handoffId=context.handoff_id;bridge.dataset.handoffTrigger=decision.trigger_code;bridge.textContent=JSON.stringify({count:debugEvents.length,events:debugEvents,handoff:{active:true,handoff_id:context.handoff_id,trigger_code:decision.trigger_code,context:context}});}
  function el(tag,attrs,text){var n=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){n.setAttribute(k,attrs[k]);});if(text)n.textContent=text;return n;}
  function init(){
    var root=el('div',{id:'omega-concierge'}),launcher=el('button',{id:'omega-concierge-launcher','aria-expanded':'false','aria-controls':'omega-concierge-panel'},'OMEGA');
    var panel=el('section',{id:'omega-concierge-panel','aria-label':'Asistente OMEGA'}),head=el('div',{class:'omega-head'}),title=el('strong',{},'OMEGA · Campus Profesional'),close=el('button',{'aria-label':'Cerrar conversación'},'×');
    var messages=el('div',{class:'omega-messages'}),actions=el('div',{class:'omega-actions'}),form=el('form',{class:'omega-form'}),input=el('input',{type:'text',placeholder:'Escribí tu consulta…','aria-label':'Consulta'}),send=el('button',{type:'submit'},'Enviar');
    head.append(title,close);form.append(input,send);panel.append(head,messages,actions,form);root.append(panel,launcher);document.body.append(root);
    function add(text,who){messages.append(el('div',{class:'omega-msg '+who},text));messages.scrollTop=messages.scrollHeight;}
    function open(){panel.classList.add('open');launcher.setAttribute('aria-expanded','true');if(!state.started){state.started=true;track('conversation_started');add('Hola, soy OMEGA.\n¿En qué puedo orientarte?','bot');}}
    async function reply(text){
      track('web_chat_request_started');
      try{
        var response=await fetch('/api/omega/web-chat/v1',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,conversation_ref:state.conversation_id,page_url:window.location.href})});
        var body=null;try{body=await response.json();}catch(_error){}
        if(!response.ok||!body||body.ok!==true||!body.response||typeof body.response.text!=='string')throw new Error('web_chat_transport_failed');
        (body.events||[]).forEach(function(item){if(item&&item.event)track(item.event);});
        track('web_chat_response_received',{response_mode:body.runtime&&body.runtime.response_mode||null,grounding_status:body.grounding&&body.grounding.status||null});
        add(body.response.text,'bot');
      }catch(_error){
        track('web_chat_transport_error');
        add('Hubo un problema de conexión. Intentá nuevamente.','bot');
      }
    }
    launcher.onclick=open;close.onclick=function(){panel.classList.remove('open');launcher.setAttribute('aria-expanded','false');};form.onsubmit=function(e){e.preventDefault();var text=input.value.trim();if(text){add(text,'user');input.value='';reply(text);}};
    ['Ver cursos','Consultar certificación','Cómo inscribirme'].forEach(function(label){var b=el('button',{},label);b.onclick=function(){input.value=label;form.requestSubmit();};actions.append(b);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
