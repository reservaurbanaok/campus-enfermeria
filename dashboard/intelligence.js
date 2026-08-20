(function () {
  const clamp = n => Math.max(0, Math.min(100, Number(n)));
  const pct = (part, total) => Number(total) > 0 ? clamp(Number(part) / Number(total) * 100) : null;
  const round = n => n == null ? null : Math.round(n * 100) / 100;
  const collectionRate = (paid, billed) => pct(paid, billed);
  const learningScore = n => {
    if (!n || !n.enrolled) return null;
    return round(clamp((pct(n.active_7d, n.enrolled) || 0) * .4 + (Number(n.average_progress_pct) || 0) * .35 + (pct(n.evaluated, n.enrolled) || 0) * .15 + (pct(n.completed, n.enrolled) || 0) * .1));
  };
  const riskScore = (n, debtors, total) => {
    if (!n || !n.enrolled) return null;
    const inactivity = pct(n.inactive, n.enrolled) || 0;
    const debt = total > 0 && debtors != null ? pct(debtors, total) || 0 : 0;
    return round(clamp(100 - (.7 * inactivity + .3 * debt)));
  };
  const healthScore = scores => {
    const weights = { business: .3, acquisition: .2, learning: .3, risk: .2 };
    const available = Object.keys(weights).filter(k => scores[k] != null);
    if (available.length < 3) return null;
    const weight = available.reduce((s, k) => s + weights[k], 0);
    return round(clamp(available.reduce((s, k) => s + scores[k] * weights[k], 0) / weight));
  };
  const severity = (value, red, yellow) => value < red ? "ROJO" : value < yellow ? "AMARILLO" : null;
  const build = ({ business, netroom }) => {
    const collection = collectionRate(business.paid, business.billed);
    const learning = learningScore(netroom);
    const risk = riskScore(netroom, business.debtors, business.totalStudents);
    const scores = { business: collection, acquisition: null, learning, risk };
    const alerts = [];
    const collectionSeverity = severity(collection ?? 100, 70, 85);
    if (collectionSeverity) alerts.push({ category: "COBRANZA", severity: collectionSeverity, text: collectionSeverity === "ROJO" ? "Cobranza por debajo del 70%" : "Cobranza entre 70% y 85%", source: "TOTAL_COBRADO / FACTURACION_TOTAL" });
    const inactiveSeverity = severity(pct(netroom.inactive, netroom.enrolled) ?? 0, 30, 50);
    if (inactiveSeverity) alerts.push({ category: "ACADÉMICA", severity: inactiveSeverity, text: "Inactividad académica elevada", source: "INACTIVE / ENROLLED" });
    const progressSeverity = severity(Number(netroom.average_progress_pct) || 0, 30, 50);
    if (progressSeverity) alerts.push({ category: "ACADÉMICA", severity: progressSeverity, text: "Progreso promedio por debajo del objetivo", source: "AVERAGE_PROGRESS_PCT" });
    const insights = [];
    if (netroom.evaluated > 0) insights.push({ category: "ACADÉMICA", text: `${netroom.passed} de ${netroom.evaluated} alumnos que evaluaron aprobaron`, source: "PASSED / EVALUATED" });
    return { scores, health: healthScore(scores), alerts, insights, acquisition: null, formulas: { business: "TOTAL_COBRADO / FACTURACION_TOTAL * 100", learning: "40% ACTIVE_RATE + 35% AVERAGE_PROGRESS + 15% ASSESSMENT_PARTICIPATION + 10% COMPLETION_RATE", risk: "100 - (70% ACADEMIC_INACTIVITY_RATE + 30% DEBTOR_RATE)" } };
  };
  window.Intelligence = { clamp, collectionRate, learningScore, riskScore, healthScore, build };
})();
