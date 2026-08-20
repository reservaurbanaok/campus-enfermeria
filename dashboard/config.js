window.CONFIG = { API_URL: "/api/dashboard/alumnos", GA4_URL: "/api/dashboard/ga4", LUCA_URL: "/api/dashboard/luca", NETROOM_URL: "/api/dashboard/netroom" };

(function initLucaDashboard() {
  function fmt(n) { return Number(n || 0).toLocaleString("es-AR"); }
  function escH(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
  function listRows(items, emptyText) {
    if (!items || !items.length) return '<div style="color:var(--muted);font-size:.85rem">' + emptyText + '</div>';
    const max = Math.max(...items.map(item => Number(item.value || 0)), 1);
    return items.map(item => {
      const width = Math.max(4, Math.round(Number(item.value || 0) / max * 100));
      return '<div class="channel-row"><div class="channel-label">' + escH(item.label) + '</div><div class="channel-bar-wrap"><div class="channel-bar" style="width:' + width + '%;background:var(--accent3)"></div></div><div class="channel-val">' + fmt(item.value) + '</div></div>';
    }).join("");
  }
  function ensureLucaSection() {
    if (document.getElementById("lucaSection")) return;
    const ga4Title = Array.from(document.querySelectorAll(".section-title")).find(el => el.textContent.includes("Google Analytics"));
    const html = '<div id="lucaSection"><div class="section-title">Inteligencia Comercial Luca - WhatsApp e Instagram</div>' +
      '<div class="grid grid-4"><div class="card accent-purple"><div class="metric-label">Conversaciones Totales</div><div id="l_total" class="metric-value">-</div><div class="metric-sub">Base historica registrada</div></div><div class="card accent-left"><div class="metric-label">Consultas Hoy</div><div id="l_hoy" class="metric-value">-</div><div class="metric-sub">Movimiento comercial diario</div></div><div class="card accent-green"><div class="metric-label">Ultimos 7 Dias</div><div id="l_7" class="metric-value">-</div><div class="metric-sub">Demanda reciente</div></div><div class="card" style="border-left:3px solid var(--yellow)"><div class="metric-label">Leads Calientes</div><div id="l_hot" class="metric-value">-</div><div class="metric-sub">Formulario, pago o intencion alta</div></div></div><br>' +
      '<div class="grid grid-4"><div class="card"><div class="metric-label">Pidieron PDF</div><div id="l_pdf" class="metric-value">-</div></div><div class="card"><div class="metric-label">Pidieron Formulario</div><div id="l_form" class="metric-value">-</div></div><div class="card"><div class="metric-label">Pidieron Pago</div><div id="l_pago" class="metric-value">-</div></div><div class="card"><div class="metric-label">Escalados A Humano</div><div id="l_escalados" class="metric-value">-</div></div></div><br>' +
      '<div class="grid grid-2"><div class="card"><h3>Cursos Mas Consultados</h3><div id="l_cursos" style="color:var(--muted);font-size:.85rem">Cargando...</div></div><div class="card"><h3>Etapas De Conversacion</h3><div id="l_etapas" style="color:var(--muted);font-size:.85rem">Cargando...</div></div></div><br>' +
      '<div class="card"><h3>Ultimas Conversaciones</h3><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>WhatsApp</th><th>Curso</th><th>Etapa</th><th>Mensaje</th></tr></thead><tbody id="l_recientes"><tr><td colspan="5" style="color:var(--muted);text-align:center;padding:18px">Cargando...</td></tr></tbody></table></div></div><br></div>';
    if (ga4Title) ga4Title.insertAdjacentHTML("beforebegin", html);
  }
  async function fetchLuca() {
    if (!window.CONFIG || !CONFIG.LUCA_URL) return;
    ensureLucaSection();
    try {
      const res = await fetch(CONFIG.LUCA_URL);
      if (!res.ok) throw new Error("No responde Luca");
      const data = await res.json();
      if (data.error) throw new Error(data.message || "Error de Luca");
      document.getElementById("l_total").innerText = fmt(data.total);
      document.getElementById("l_hoy").innerText = fmt(data.hoy);
      document.getElementById("l_7").innerText = fmt(data.ultimos7);
      document.getElementById("l_hot").innerText = fmt(data.calientes);
      document.getElementById("l_pdf").innerText = fmt(data.pdf);
      document.getElementById("l_form").innerText = fmt(data.formulario);
      document.getElementById("l_pago").innerText = fmt(data.pago);
      document.getElementById("l_escalados").innerText = fmt(data.escalados);
      document.getElementById("l_cursos").innerHTML = listRows(data.cursos, "Sin cursos disponibles");
      document.getElementById("l_etapas").innerHTML = listRows(data.etapas, "Sin etapas disponibles");
      const recientes = data.recientes || [];
      document.getElementById("l_recientes").innerHTML = recientes.length ? recientes.map(item => '<tr><td>' + escH(item.timestamp) + '</td><td>' + escH(item.whatsapp) + '</td><td>' + escH(item.curso_consultado) + '</td><td><span class="badge ' + (String(item.escalado_humano || "").toUpperCase() === "SI" ? "warn" : "ok") + '">' + escH(item.etapa_final) + '</span></td><td>' + escH(item.mensaje_usuario).slice(0, 120) + '</td></tr>').join("") : '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:18px">Sin conversaciones recientes</td></tr>';
    } catch (err) {
      ensureLucaSection();
      document.getElementById("l_cursos").innerHTML = '<div style="color:var(--red)">Error cargando Luca: ' + escH(err.message) + '</div>';
    }
  }
  window.addEventListener("load", () => {
    ensureLucaSection();
    const originalStartDashboard = window.startDashboard;
    window.startDashboard = function patchedStartDashboard() {
      if (typeof originalStartDashboard === "function") originalStartDashboard();
      fetchLuca();
      setInterval(fetchLuca, 30000);
    };
  });
})();
