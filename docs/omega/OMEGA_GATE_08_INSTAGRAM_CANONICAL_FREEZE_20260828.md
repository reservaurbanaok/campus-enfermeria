# OMEGA Gate 08 — Instagram canonical freeze

Date: 2026-08-28
Owner: Martín Gorchs — El Catalán
Environment: STAGING only

## Canonical result

`GATE_08_INSTAGRAM = CLOSED_PASS`
`INSTAGRAM_BRANCH = CLOSED_PASS`
`INSTAGRAM_BRANCH_STATUS = FROZEN_CANONICAL`
`REOPEN_ONLY_ON_REGRESSION = YES`

Instagram account: `campus.enfermeria`
Instagram User ID: `17841433759878333`
Graph host: `graph.instagram.com`

## Verified path

Real external Instagram account
→ `@campus.enfermeria`
→ Meta webhook
→ STAGING
→ Instagram normalizer
→ `OMEGA_CHANNEL_MESSAGE_V1`
→ channel routing
→ Campus Core
→ Canonical Core
→ skill routing
→ `OMEGA_CHANNEL_RESPONSE_V1`
→ Instagram Graph outbound
→ real automatic reply

## Evidence baseline

- Instagram Login: PASS
- Instagram callback: PASS
- `messages` subscription: PASS
- Durable credential storage: Neon STAGING
- Token at rest: AES-256-GCM
- Credential restore after redeploy: PASS
- Instagram inbound: PASS
- OMEGA Core processing: PASS
- Instagram Graph outbound: PASS
- Real E2E: PASS
- Graph response: HTTP 200 with Meta message ID present
- Real reply: confirmed immediately by Owner
- Duplicate outbound: NO
- Manual operator response: NO
- Automatic OMEGA origin: PASS

No secrets, tokens, authorization codes or message IDs are recorded here.

## Gate-level disposition

`GATE_08_INSTAGRAM = CLOSED_PASS`
`GATE_08_FACEBOOK = DEFERRED_WITHIN_GATE_08`
`GATE_08_OVERALL = PARTIAL_OPEN_BY_DEFERRED_BRANCH`

Facebook Messenger remains outside this freeze and requires separate Owner
authorization. WhatsApp, WF04, Gate 07, PROD and NETROOM remain frozen or
untouched.
