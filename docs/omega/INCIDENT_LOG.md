# Gate 08 incident log

## 2026-08-28 — real Instagram canary webhook boundary

- Scope: STAGING Instagram only. PROD, NETROOM, WhatsApp and WF04 unchanged.
- Symptom: Meta POSTs to `/webhook/gate08/instagram` were returning HTTP 401.
- First failed boundary: Meta webhook signature validation.
- Root cause: STAGING had the Instagram OAuth app secret configured separately
  from the webhook-secret variable; the handler only checked the webhook
  variable, so the HMAC never matched the signature produced for the active
  Instagram Login application.
- Minimal fix: validate the required `x-hub-signature-256` HMAC against the
  configured Instagram app-secret candidates, without accepting unsigned or
  malformed signatures. Added sanitized webhook/pipeline observability only.
- Verification: targeted Gate 08 staging, outbound and OAuth tests passed.
- Deployment: `4497f678-5019-440b-99c6-6bdadeb3ce9a` reached SUCCESS.
- Canary evidence: one signed message webhook reached STAGING with HTTP 200;
  the normalized message and core pipeline completed. No sender call was
  recorded because the deployment restart cleared the in-memory OAuth session
  before that webhook arrived.
- Recovery: one fresh OAuth authorization for `campus.enfermeria` completed
  on the corrected STAGING deployment at HTTP 200. No canary was resent and no
  outbound message was initiated by Codex.
- Remaining boundary: the original accepted webhook is not replayable from
  available evidence because its sender ID and payload were not durably
  persisted; Meta stopped retrying after the successful webhook response.

## 2026-08-28 — durable credential recovery

- Scope: STAGING Instagram only. PROD, NETROOM, WhatsApp and WF04 unchanged.
- Fix: encrypted credential storage in the existing Neon database, dedicated
  Railway encryption secret, boot restoration and live identity/subscription
  verification.
- Tests: Gate 08 OAuth, outbound and staging adapter tests passed; Python
  WhatsApp/WF04 regression suite passed.
- Deployments: credential implementation `7b3162c2-67c0-411c-a559-cf3ff14d0d36`;
  redeploy survival verification `0fcefa39-7d2f-44b7-bb28-c7954cc62f64`.
- Evidence: after the survival redeploy, health returned 200 and sanitized
  `instagram_credential_restored` reported the expected username, ID and
  `messaging_permission=PASS`.
- Recovery result: historical logs contain only the original canary's safe
  hashes/traces and HTTP metadata; no payload or sender ID is available for a
  faithful replay. A single new external DM is therefore the only remaining
  human action, now that durable persistence is PASS.

## 2026-08-28 — canonical Instagram E2E confirmation

- One real inbound execution at approximately `20:13:21Z` produced one
  `instagram_pipeline_pass` and one `instagram_send_attempt`.
- Correlation: expected Instagram business ID, same execution timestamp, and
  exact equality between the pipeline sender hash and Graph recipient hash.
- Graph result: HTTP 200 with Meta message ID present; the ID is intentionally
  not recorded here.
- Owner evidence: immediate automatic reply received in the external real
  Instagram conversation.
- Result: Gate 08 Instagram real E2E PASS; duplicate outbound NO; manual
  operator response NO; WhatsApp/WF04/Gate 07/PROD/NETROOM unchanged.

## 2026-08-28 — Instagram branch canonical freeze

- Documentation-only closure completed; no runtime, OAuth, Meta, canary or
  deployment action performed.
- `OMEGA_GATE_08_INSTAGRAM_BRANCH = CLOSED_PASS`.
- `INSTAGRAM_BRANCH_STATUS = FROZEN_CANONICAL`.
- Reopen condition: demonstrated regression only.
- Facebook remains `DEFERRED_WITHIN_GATE_08`; overall Gate 08 remains
  `PARTIAL_OPEN_BY_DEFERRED_BRANCH`.

## 2026-08-28 — Gate 09 real event activation plumbing

- Scope: STAGING only. Gate 08, WhatsApp, WF04, PROD and NETROOM unchanged.
- Confirmed boundary: canonical emitter present, Event Store writer present,
  Neon connection present and `OMEGA_COMMERCIAL_EVENT_STORE_ENABLED=true`.
- Isolated event: stored and queryable in Neon, marked `test_event=true`,
  excluded from business KPIs/Sensor, then deleted by its dedicated namespace.
- Final isolated result: `business_event_count=0`, `test_event_count=0`,
  `DATA_QUALITY=PASS`, Sensor `INSUFFICIENT_DATA`.
- Deployment: Gate 09 activation plumbing `27db7e34-8e32-4960-abae-5727b07feefe`
  succeeded in `omega-campus-core-staging`.
- Auth finding: no existing dashboard or operator credential variables are
  configured in STAGING. The view/API remain protected; no credential was
  generated or exposed.
- Remaining boundary: one real post-activation STAGING conversation is needed
  to prove business-event visibility. No synthetic business event or outbound
  message was sent.

## 2026-08-28 — Gate 09 dashboard authentication resolved

- No existing dashboard/operator credential variables were present in STAGING.
- Authorized fix: generated cryptographically strong STAGING-only password and
  session secret, configured both through Railway without printing values.
- Added only the existing auth route wiring needed by the STAGING server:
  `/api/auth/login`, `/api/auth/status` and `/api/auth/logout`.
- Verification: login 200, session status 200, authenticated commercial API
  200, view 200, unauthenticated API 401.
- Secure handoff contains only dashboard URL and password, is outside Git, and
  does not contain the session secret, database credentials or tokens.
- Remaining boundary: no real post-activation business event exists. The
  system is ready for one external Instagram DM; Codex sent none.

## 2026-08-28 — Gate 09 real event activation PASS

- One real Owner-sent Instagram conversation produced one canonical business
  event: `intent_detected`.
- Neon evidence: one non-test row, valid `omega-events-v1`, channel Instagram,
  source `omega_instagram_social_ingress`, sanitized metadata and hashed
  correlation reference.
- Correlation: the Neon correlation prefix matches the single recent
  `instagram_pipeline_pass`; one recent outbound send attempt was observed and
  no duplicate/replay was issued by Codex.
- KPI/dashboard/Sensor evidence: authenticated API 200, one business event,
  one conversation, one intent and Sensor `MEASURED`.
- Result: `OMEGA_GATE_09_REAL_EVENT_ACTIVATION = PASS`,
  `REAL_STAGING_DATA_STATUS = REAL_DATA_VISIBLE`.
- Interpretation remains deliberately limited: one conversation is
  insufficient for trend, course ranking or funnel conversion claims.

## 2026-08-28 — Gate 10 Retention Eligibility Projection V1 PASS

- Scope: Campus-only, read-only, STAGING only. No NETROOM reads or mutations,
  no PROD, no new UI, no Gate 09/Instagram/WhatsApp/WF04 runtime change.
- Implemented `api/_lib/retention-eligibility-projector.js` and protected
  GET `/api/dashboard/retention-eligibility` over the existing Neon Event Store.
- Contract tests A-F, test-event exclusion, sanitization, GET-only behavior and
  current-real false-positive guard: PASS (9/9).
- Regression suite Gate 07/08/09 plus Gate 10: PASS (21/21).
- STAGING deployment `f0855011-2fb4-419e-babc-ca5fc69874de` is Online. Smoke:
  health 200, authenticated projection API 200, unauthenticated projection
  API 401.
- Current real projection: one `intent_detected`, no authorized lifecycle
  evidence, `NOT_RETENTION_ELIGIBLE` / `PROSPECT`; next-course eligibility is
  false.
- Result: `OMEGA_GATE_10_RETENTION_ELIGIBILITY_V1 = PASS`.

## 2026-08-28 — Gate 10 enrollment_completed instrumentation PASS

- Identified Gate 06's authoritative source as the payment/outbox bridge; no
  NETROOM read or change was performed.
- Added the Campus STAGING HMAC receiver for the minimum
  `enrollment_completed` contract. Replay is idempotent and the server does
  not accept payment secrets, raw identity or academic fields.
- Focal tests: 5/5 PASS. Gate 10 projector tests: 9/9 PASS. No synthetic event
  was inserted into Neon; fixtures remain isolated from commercial metrics.
- Deployment `dfde7651-000d-4893-91c6-7cbbd28ff6d5` is Online. Smoke verified
  health 200, authenticated APIs 200 and unsigned bridge request 401.
- Real current projection remains `NOT_RETENTION_ELIGIBLE / PROSPECT`; no real
  confirmed enrollment is available. `REAL_VALIDATION_STATUS =
  READY_FOR_REAL_ENROLLMENT_SIGNAL`.

## 2026-08-28 — Gate 10 onboarding and netroom_ready signals PASS

- Added the Campus-only Gate 06 lifecycle receiver for explicit
  `onboarding_started` and canonical `netroom_access_ready` signals.
- Preconditions are enforced in the Campus Event Store: enrollment before
  onboarding, and enrollment + onboarding before readiness. Invalid ordering
  returns 409 without inserting an event.
- Isolated chain tests and regression suite: 32/32 JavaScript PASS; Python
  suite 4/4 PASS. No synthetic business event was sent to Neon.
- Deployment `72d81ba4-ffb5-4d90-ba1a-e47e8936be90` is Online. Health 200,
  login 200 and unsigned lifecycle requests 401.
- Real validations: `READY_FOR_REAL_SIGNAL` for both onboarding and readiness;
  current real projection remains `NOT_RETENTION_ELIGIBLE / PROSPECT`.

## 2026-08-31 — Explore Options false verified catalog

- Symptom: the agent said the Campus catalog was unavailable although the
  official homepage published current offer cards.
- Root cause: `course=null` produced an empty Explore Options evidence chunk,
  while page load alone was marked `VERIFIED`.
- Fix: extract `.curso-card-title` items from official HTML and require
  relevant catalog evidence before `VERIFIED`; add catalog intent phrases and
  a minimal WhatsApp unbalanced-emphasis guard.
- Evidence: 7 catalog items; STAGING deployment
  `d59fc301-2dac-4451-b906-b30ef7901a87`; Explore Options 5/5 and regressions
  PASS. No channel, Meta, NETROOM or PROD mutation.

## 2026-08-31 — Instagram outbound credential lifecycle regression

- Symptom: inbound, identity normalization and OMEGA Core passed, but the
  outbound credential was unavailable after a real Instagram event.
- Evidence: encrypted record decrypted, local expiry metadata looked valid,
  and live profile validation returned HTTP 401 OAuthException 190. The
  effective persisted app/user/profile context remained canonical.
- Repair: the existing Gate 08 callback now performs the official short-lived
  to LONG_LIVED exchange, validates the long-lived token before persistence,
  records Meta's real expiry metadata, performs live startup validation and
  refreshes only at the approved threshold. The old encrypted record remains
  intact until the replacement is validated and written.
- Validation: lifecycle tests 11/11 PASS; no Meta, channel, WhatsApp, NETROOM
  or PROD mutation; no new Instagram canary sent. STAGING release validation
  and Owner OAuth reauthorization remain the next boundary.

## 2026-08-31 — Instagram dispatch early exit

- Symptom: the final real Instagram webhook completed the semantic agent and
  returned HTTP 200, but no visible reply, `instagram_send_attempt`, or Meta
  outbound status existed.
- Confirmed boundary: `instagram_dispatch` before Meta Send API. A sanitized
  replay with the same response contract showed `response_text_present=true`,
  `should_send=true`, recipient present, and preflight exit
  `TEXT_LENGTH_OVER_LIMIT` / `invalid_instagram_text` before credential
  resolution and fetch.
- Minimal fix: raise only the Instagram sender local text ceiling from 500 to
  1000 characters and add sanitized dispatch lifecycle logs. Replay with Meta
  intercepted passes; no real message was sent during repair.
