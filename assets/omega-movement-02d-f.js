(function () {
  'use strict';

  function init() {
    var heroTrigger = document.getElementById('omega-assistant-cta');
    var floatingTrigger = document.getElementById('omega-float');
    var runtimeLauncher = document.getElementById('omega-concierge-launcher');
    var panel = document.getElementById('omega-concierge-panel');
    var head = panel && panel.querySelector('.omega-head');
    if (!heroTrigger || !floatingTrigger || !runtimeLauncher || !panel) return;

    panel.setAttribute('aria-label', 'Asistente OMEGA');
    var title = head && head.querySelector('strong');
    if (title) title.textContent = 'OMEGA · Campus Profesional';
    if (!panel.querySelector('.omega-visual-intro')) {
      var visual = document.createElement('div');
      visual.className = 'omega-visual-intro';
      visual.setAttribute('aria-hidden', 'true');
      var figure = document.createElement('img');
      figure.src = 'assets/omega/OMEGA_FLOATING_MASTER_V2.png';
      figure.width = 1024;
      figure.height = 1536;
      figure.alt = '';
      figure.decoding = 'sync';
      visual.appendChild(figure);
      panel.insertBefore(visual, panel.querySelector('.omega-messages'));
    }

    var messages = panel.querySelector('.omega-messages');
    function syncTriggerState() {
      var open = panel.classList.contains('open');
      heroTrigger.setAttribute('aria-expanded', String(open));
      floatingTrigger.setAttribute('aria-expanded', String(open));
      floatingTrigger.setAttribute('aria-label', open ? 'OMEGA abierta' : 'Abrir OMEGA, asistente virtual del Campus');
    }

    function openSharedChat(event) {
      if (event) event.preventDefault();
      if (!panel.classList.contains('open')) runtimeLauncher.click();
      syncTriggerState();
    }

    [heroTrigger, floatingTrigger].forEach(function (trigger) {
      trigger.addEventListener('click', openSharedChat);
    });

    runtimeLauncher.hidden = true;
    runtimeLauncher.setAttribute('tabindex', '-1');
    runtimeLauncher.setAttribute('aria-hidden', 'true');

    if (head && !head.querySelector('[data-omega-minimize]')) {
      var minimize = document.createElement('button');
      minimize.type = 'button';
      minimize.setAttribute('aria-label', 'Minimizar conversación');
      minimize.setAttribute('data-omega-minimize', 'true');
      minimize.textContent = '−';
      minimize.addEventListener('click', function () {
        panel.classList.remove('open');
        runtimeLauncher.setAttribute('aria-expanded', 'false');
        syncTriggerState();
      });
      head.insertBefore(minimize, head.querySelector('button'));
    }

    var observer = new MutationObserver(syncTriggerState);
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    syncTriggerState();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
