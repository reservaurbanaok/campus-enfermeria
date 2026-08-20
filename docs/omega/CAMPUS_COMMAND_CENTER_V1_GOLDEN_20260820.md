# Campus Command Center V1 Golden

## Canonical checkpoint

- Canonical commit: `0da75d69c8349810436bf2904819433aa8f112e5`
- Production deployment: `dpl_3u5NhBonCN8TF7vnnX66A8BSXZDP`
- Status: production baseline frozen

## Active worlds

- World 01 — Negocio: PASS
- World 02 — Adquisición / GA4: PASS
- World 03 — NETROOM: PASS
- World 04 — Inteligencia: PASS

## Sources and invariants

- Negocio: authenticated Dashboard alumnos/business source.
- Adquisición: GA4 authenticated source.
- Aprendizaje: NETROOM certified read-only analytics.
- NETROOM mode: read-only.
- Source of Truth: PASS.
- NETROOM mutations: 0.
- Student, progress, evaluation, enrollment, identity, and schema writes: 0.

## Intelligence V1

- Negocio score: collection rate = `TOTAL_COBRADO / FACTURACION_TOTAL * 100`.
- Learning score: `40% ACTIVE_RATE + 35% AVERAGE_PROGRESS + 15% ASSESSMENT_PARTICIPATION + 10% COMPLETION_RATE`.
- Risk score: `100 - (70% ACADEMIC_INACTIVITY_RATE + 30% DEBTOR_RATE)`.
- Campus Health Score: weighted average of available dimensions with proportional redistribution when a dimension is null.
- Alerts and insights: deterministic, source-backed, and auditable.
- Acquisition score: `null`.
- Acquisition status: baseline histórico pendiente. This is a temporary data limitation, not a defect.
- Generative AI/LLM: not used.

## Luca quarantine

- Runtime status: `DISABLED_QUARANTINED`.
- Runtime calls: 0.
- Luca remains recoverable through Git history and must not be reactivated without explicit authorization.

## Quality gates

- Authentication: PASS.
- Logout: PASS.
- NETROOM degraded mode: PASS.
- Desktop: PASS.
- Mobile 360: PASS.
- Mobile 390: PASS.
- Runtime errors: NONE.

## Golden rule

This checkpoint is the canonical Campus Command Center V1 baseline. Future changes must preserve Negocio, GA4, NETROOM read-only, Intelligence, authentication, degraded mode, and mobile behavior. Luca must remain disabled unless explicitly authorized.
