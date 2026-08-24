(function(){
  'use strict';
  var courses=[
    {key:'escolar',name:'Diplomatura en Enfermería Escolar',duration:'6 meses',mode:'online',cert:'Certificado avalado por Instituto Ferrer',url:'https://forms.gle/U3U9LupYuZFVgLEK8'},
    {key:'anestesia',name:'Diplomatura en Anestesia y Cirugía para Enfermería',duration:'8 meses',mode:'online',cert:'Certificado avalado por Instituto Ferrer',url:'https://docs.google.com/forms/d/e/1FAIpQLSdWfA62k0kVFJC4CPs4lFoAF7yckJb6Szn0O7n8YLwNFNHSrw/viewform?usp=sharing&ouid=100450418402124974487'},
    {key:'cuidados',name:'Diplomatura en Cuidados Críticos y Emergencias para Enfermería',duration:'6 meses',mode:'Zoom sincrónico',cert:'Información de certificación publicada en el Campus',url:'https://forms.gle/BFChKGf5XNZPcQAR7'}
  ];
  var state={started:false};
  function track(name,detail){var event={event:name,omega_source:'campus_web',detail:detail||undefined};window.__omegaEvents=window.__omegaEvents||[];window.__omegaEvents.push(event);window.dataLayer=window.dataLayer||[];window.dataLayer.push(event);}
  function el(tag,attrs,text){var n=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){n.setAttribute(k,attrs[k]);});if(text)n.textContent=text;return n;}
  function init(){
    var root=el('div',{id:'omega-concierge'}), launcher=el('button',{id:'omega-concierge-launcher','aria-expanded':'false','aria-controls':'omega-concierge-panel'},'Hablar con Omeguín');
    var panel=el('section',{id:'omega-concierge-panel','aria-label':'Asistente Omeguín'}), head=el('div',{class:'omega-head'}), title=el('strong',{},'Omeguín · Campus Profesional'), close=el('button',{'aria-label':'Cerrar conversación'},'×');
    var messages=el('div',{class:'omega-messages'}), actions=el('div',{class:'omega-actions'}), form=el('form',{class:'omega-form'}), input=el('input',{type:'text',placeholder:'Escribí tu consulta…','aria-label':'Consulta'}), send=el('button',{type:'submit'},'Enviar');
    head.append(title,close);form.append(input,send);panel.append(head,messages,actions,form);root.append(panel,launcher);document.body.append(root);
    function add(text,who){messages.append(el('div',{class:'omega-msg '+who},text));messages.scrollTop=messages.scrollHeight;}
    function open(){panel.classList.add('open');launcher.setAttribute('aria-expanded','true');if(!state.started){state.started=true;track('conversation_started');add('Hola, soy Omeguín. Puedo orientarte sobre la oferta del Campus, modalidad, duración, certificación e inscripción. ¿Qué te gustaría conocer?','bot');}}
    function reply(text){var q=text.toLowerCase();track('intent_detected',q.slice(0,80));var found=courses.filter(function(c){return q.indexOf(c.key)>-1||(c.key==='escolar'&&q.indexOf('escolar')>-1)||(c.key==='cuidados'&&(q.indexOf('crítico')>-1||q.indexOf('emergencia')>-1));});
      if(q.indexOf('netroom')>-1||q.indexOf('nota')>-1||q.indexOf('progreso')>-1||q.indexOf('alumno')>-1){add('No puedo consultar datos académicos privados ni NETROOM. Para eso corresponde ingresar por el Campus Virtual.','bot');return;}
      if(q.indexOf('precio')>-1||q.indexOf('costo')>-1||q.indexOf('valor')>-1){track('price_asked');add('El precio no está disponible en la información pública que tengo cargada. Te recomiendo consultarlo por el canal oficial del Campus, sin asumir un importe.','bot');return;}
      if(q.indexOf('certif')>-1||q.indexOf('aval')>-1){track('certification_asked');add('El Campus publica certificación/aval del Instituto Ferrer para sus diplomaturas. Si necesitás el formato o alcance exacto, corresponde consultarlo con el Campus.','bot');return;}
      if(q.indexOf('inscrib')>-1||q.indexOf('anotar')>-1||q.indexOf('cursar')>-1){track('enrollment_intent_detected');var c=found[0];if(c){add('Podés iniciar la consulta o inscripción desde el formulario oficial de '+c.name+'. La apertura del formulario no confirma una inscripción completada.','bot');offer(c);}else{add('¿Qué capacitación te interesa? Puedo ofrecerte el formulario oficial de la opción correspondiente.','bot');}return;}
      if(found.length){track('course_asked',found[0].key);var c=found[0];track('course_recommended',c.key);add(c.name+'\nDuración publicada: '+c.duration+'. Modalidad publicada: '+c.mode+'. '+c.cert+'.','bot');offer(c);return;}
      if(q.indexOf('modal')>-1||q.indexOf('durac')>-1){add('Puedo darte esos datos si me indicás qué capacitación estás evaluando.','bot');return;}
      if(q.indexOf('hola')>-1||q.indexOf('ayuda')>-1){add('Puedo ayudarte a comparar capacitaciones, revisar duración y modalidad, consultar certificación o llevarte al formulario oficial de inscripción.','bot');return;}
      add('Puedo orientarte sobre cursos del Campus, duración, modalidad, certificación e inscripción. ¿Qué capacitación estás evaluando?','bot');
    }
    function offer(c){var b=el('button',{},'Abrir inscripción oficial');b.onclick=function(){track('enrollment_link_offered',c.key);window.open(c.url,'_blank','noopener');};actions.replaceChildren(b);}
    launcher.onclick=open;close.onclick=function(){panel.classList.remove('open');launcher.setAttribute('aria-expanded','false');};form.onsubmit=function(e){e.preventDefault();var text=input.value.trim();if(text){add(text,'user');input.value='';reply(text);}};
    ['Ver cursos','Consultar certificación','Cómo inscribirme'].forEach(function(label){var b=el('button',{},label);b.onclick=function(){input.value=label;form.requestSubmit();};actions.append(b);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
