'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const state = { handoffs: [], selected: null };
  const loginView = $('login-view'), inboxView = $('inbox-view');
  const text = (id, value) => { $(id).textContent = value == null || value === '' ? '—' : String(value); };
  const array = (value) => Array.isArray(value) ? value : [];
  const contextValue = (ctx, flat, nested) => ctx?.[flat] ?? nested.reduce((item, key) => item?.[key], ctx);
  const context = (handoff) => handoff?.handoff_context || {};
  const labelCourse = (course) => course ? (course.public_name || course.name || course.course_id || course.slug || '—') : '—';
  const questions = (ctx) => contextValue(ctx, 'questions_asked', ['commercial', 'questions']) || [];
  const answers = (ctx) => contextValue(ctx, 'relevant_answers', ['commercial', 'relevant_answers']) || [];

  async function api(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    let body = null; try { body = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(body?.error || `http_${response.status}`); error.status = response.status; throw error; }
    return body;
  }
  function setStatus(message, error = false) { $('global-status').textContent = message || ''; $('global-status').style.color = error ? 'var(--red)' : ''; }
  function showInbox() { loginView.hidden = true; inboxView.hidden = false; }
  function showLogin() { loginView.hidden = false; inboxView.hidden = true; }

  async function login(event) {
    event.preventDefault(); $('login-error').textContent = '';
    const button = event.target.querySelector('button'); button.disabled = true;
    try { await api('/api/auth/operator-login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ credential:$('credential').value }) }); $('credential').value = ''; showInbox(); await loadList(); }
    catch { $('login-error').textContent = 'Credencial inválida o acceso no disponible.'; }
    finally { button.disabled = false; }
  }
  function renderList() {
    const list = $('case-list'); list.replaceChildren(); $('case-count').textContent = state.handoffs.length;
    if (!state.handoffs.length) { const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'No hay casos activos.'; list.append(empty); return; }
    state.handoffs.forEach((handoff) => {
      const button = document.createElement('button'); button.className = `case${state.selected?.handoff_id === handoff.handoff_id ? ' selected' : ''}`; button.type = 'button';
      const top = document.createElement('div'); top.className = 'case-top'; const id = document.createElement('strong'); id.className = 'case-id'; id.textContent = handoff.handoff_id;
      const badge = document.createElement('span'); badge.className = `badge${handoff.status === 'HUMAN_ACTIVE' ? ' active' : ''}`; badge.textContent = handoff.status; top.append(id,badge);
      const meta = document.createElement('div'); meta.className = 'case-meta'; const ctx = context(handoff); meta.textContent = `${ctx.channel?.channel_id || ctx.channel || 'campus_web'} · ${labelCourse(ctx.active_course || ctx.commercial?.active_course)}`; button.append(top,meta);
      button.addEventListener('click', () => loadDetail(handoff.handoff_id)); list.append(button);
    });
  }
  function renderItems(id, items) { const root = $(id); root.replaceChildren(); const values = array(items); if (!values.length) { root.textContent = '—'; return; } values.forEach((item) => { const row = document.createElement('div'); row.textContent = typeof item === 'string' ? item : `${item.question || item.prompt || 'Dato'}${item.answer ? `: ${item.answer}` : ''}`; root.append(row); }); }
  function renderDetail(handoff) {
    state.selected = handoff; $('empty-detail').hidden = true; $('detail-content').hidden = false;
    const ctx = context(handoff); const identity = ctx.identity || {}; const channel = ctx.channel?.channel_id || ctx.channel || 'campus_web';
    const decision = ctx.handoff || {}; text('detail-status', handoff.status); $('detail-status').className = `badge${handoff.status === 'HUMAN_ACTIVE' ? ' active' : ''}`; text('detail-title-value', handoff.handoff_id); text('detail-channel', channel);
    text('fact-name', ctx.name_if_known ?? identity.name_if_known); text('fact-course', labelCourse(ctx.active_course || ctx.commercial?.active_course)); text('fact-intent', ctx.detected_intent ?? ctx.intent); text('fact-reason', ctx.handoff_reason_summary ?? decision.reason); text('fact-next', ctx.recommended_next_action ?? decision.recommended_next_action);
    renderItems('fact-qa', [...array(questions(ctx)), ...array(answers(ctx))]); renderItems('fact-objections', ctx.objections || ctx.commercial?.objections);
    $('claim').hidden = handoff.status !== 'WAITING_HUMAN'; $('resolve-form').hidden = handoff.status !== 'HUMAN_ACTIVE'; $('detail-error').textContent = '';
  }
  async function loadList() { try { const body = await api('/api/handoffs'); state.handoffs = body.handoffs || []; renderList(); if (state.selected) { const exists = state.handoffs.find((item) => item.handoff_id === state.selected.handoff_id); if (exists) await loadDetail(exists.handoff_id); else { state.selected = null; $('detail-content').hidden = true; $('empty-detail').hidden = false; } } setStatus(`Actualizado ${new Date().toLocaleTimeString('es-AR')}`); } catch (error) { if (error.status === 401) showLogin(); setStatus('No se pudo actualizar la bandeja.', true); } }
  async function loadDetail(id) { try { const body = await api(`/api/handoffs/${encodeURIComponent(id)}`); renderDetail(body.handoff); renderList(); } catch { $('detail-error').textContent = 'No se pudo cargar el caso.'; } }
  async function claim() { if (!state.selected) return; try { await api(`/api/handoffs/${encodeURIComponent(state.selected.handoff_id)}/claim`, { method:'POST' }); await loadList(); await loadDetail(state.selected.handoff_id); } catch (error) { $('detail-error').textContent = error.status === 409 ? 'El caso ya fue tomado por otro operador.' : 'No se pudo tomar el caso.'; await loadList(); } }
  async function resolve(event) { event.preventDefault(); if (!state.selected) return; const button = event.target.querySelector('button'); button.disabled = true; try { await api(`/api/handoffs/${encodeURIComponent(state.selected.handoff_id)}/resolve`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ resolution_summary:$('resolution-summary').value, human_actions_taken:[], resolved_items:[], remaining_items:[], next_owner:new FormData(event.target).get('next_owner'), ai_resume_context:{} }) }); $('resolution-summary').value = ''; await loadList(); } catch (error) { $('detail-error').textContent = error.status === 409 ? 'El caso ya no está disponible para resolver.' : 'No se pudo resolver el caso.'; } finally { button.disabled = false; } }
  $('login-form').addEventListener('submit', login); $('refresh').addEventListener('click', loadList); $('claim').addEventListener('click', claim); $('resolve-form').addEventListener('submit', resolve);
  loadList();
})();
