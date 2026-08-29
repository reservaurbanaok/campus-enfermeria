# OMEGA Gate 10 — Retention + Next Best Course foundation

## 1. Purpose

Gate 10 defines the smallest safe foundation for continued Campus
accompaniment and a future next-course opportunity. It does not sell to every
graduate: it recommends only when the available evidence shows reasonable fit
and otherwise returns `NO` or `HUMAN_REVIEW`.

Gate 10 is design-only in this movement. No NETROOM read, NETROOM mutation,
PROD action, outbound message, CRM action or integration is introduced.

## 2. Baseline

Gate 09 is operational and frozen as infrastructure:

- one real Instagram conversation is durably stored as one sanitized
  `intent_detected` event;
- `GATE_09_MVP = CLOSED_PASS`;
- `GATE_09_EVENT_PIPELINE = FROZEN_OPERATIONAL`;
- `GATE_09_DATA_COLLECTION = ACTIVE`;
- passive coverage reports `SUFFICIENT_FOR_BASIC_SIGNAL`, channel Instagram,
  one event type and no known course;
- `NO_DATA`, `ZERO` and `INSUFFICIENT_DATA` remain distinct.

The Gate 09 Event Store is the future source for authorized lifecycle signals,
but this document does not backfill or infer lifecycle state from the one
commercial-intent event.

## 3. Retention state machine V1

| State | Entry condition | Exit / allowed transitions | Required evidence | Prohibited assumption |
|---|---|---|---|---|
| `ENROLLED` | explicit authorized enrollment confirmation | `ONBOARDING` after `onboarding_started` | `enrollment_completed` or authorized enrollment status | intent or link click is not enrollment |
| `ONBOARDING` | `onboarding_started` after enrollment | `NETROOM_READY` after explicit ready signal | `onboarding_started`, identity reference | do not read onboarding details from NETROOM |
| `NETROOM_READY` | explicit `netroom_ready` / `netroom_access_ready` | `STUDENT` after allowed first-login signal | `netroom_access_ready` or equivalent authorized bridge event | access-ready is not academic progress |
| `STUDENT` | authorized student lifecycle signal | `COMPLETED` after authorized completion | `netroom_first_login` or explicit student status | no grades, attempts or lesson activity |
| `COMPLETED` | explicit completion event | `RETENTION` after an explicit retention interaction | `course_completed` | completion does not imply interest in another course |
| `RETENTION` | explicit post-completion Campus interaction | `NEXT_COURSE_OPPORTUNITY` only after fit gate passes | `retention_interaction` if later authorized, plus identity/course context | silence is not retention |
| `NEXT_COURSE_OPPORTUNITY` | deterministic fit and catalog gates pass | recommendation accepted/rejected, human review or expiry | recommendation evidence and current public catalog | recommendation is not enrollment |

Transitions are forward-only in V1 unless a later correction event is
explicitly authorized. An LLM inference alone cannot advance a state. Missing
evidence leaves the person in the last evidenced state and produces
`NO_DATA`/`HUMAN_REVIEW` as applicable.

## 4. Campus / NETROOM boundary

Gate 10 may eventually consume only an explicitly authorized minimal bridge:

```text
omega_gate10_lifecycle_v1
person_id              stable authorized reference; never a raw secret
course_id              existing Campus course ID where applicable
enrollment_status      explicit lifecycle enum
netroom_ready          explicit boolean/signal
course_completed       explicit boolean/event
occurred_at            event timestamp
source                 authorized Campus lifecycle source
correlation_id         opaque correlation reference
```

The bridge must exclude grades, assessment attempts, lesson progress, detailed
academic activity, private academic records, transcripts and inferred
academic performance. Gate 10 does not read NETROOM in this movement; any
future bridge requires a separate authorization and contract test.

## 5. Next Best Course decision contract V1

### Inputs

- verified Campus identity or an explicitly authorized person reference;
- current/previous course ID;
- explicit goals or interests from an authorized Campus interaction;
- evidenced Gate 10 lifecycle state;
- current public Campus course catalog from its official source of truth;
- unresolved objections, human request and consent/authorization status.

### Decision

The deterministic eligibility gate runs first:

1. state is `RETENTION` or an evidenced `NEXT_COURSE_OPPORTUNITY` candidate;
2. identity and current course are known and authorized;
3. at least one explicit goal/interest maps to a current public course;
4. the target is not the same completed course;
5. no unresolved human request, privacy restriction or stale catalog fact
   blocks the recommendation.

If any required fact is missing, return `NO` with a reason or
`HUMAN_REVIEW` when a person must decide. Reasoning may explain fit only after
the deterministic gate passes; it may not invent course facts or state
transitions.

### Output

```text
RECOMMENDATION = YES | NO | HUMAN_REVIEW

YES:
  recommended_course_id
  fit_reasons
  evidence: event/correlation references and catalog references
  confidence: HIGH | MEDIUM | LOW, rule-based not statistical certainty
  next_action

NO:
  reason

HUMAN_REVIEW:
  reason
  handoff_packet: minimal authorized context only
```

`YES` does not send a message or enroll a person. It produces a reviewable
opportunity until a separately authorized channel action exists.

## 6. Events and KPIs

Reuse the existing taxonomy: `course_completed`,
`next_course_recommended`, `recommendation_accepted`,
`recommendation_rejected`, `enrollment_started` and
`enrollment_completed`. A `retention_interaction` event is a future candidate
only if no existing authorized Campus event can represent that interaction;
it is not added now.

Future KPI definitions:

- completed → retention interaction;
- retention → next-course recommendation;
- recommendation → acceptance/rejection;
- accepted recommendation → repeat enrollment.

Every rate requires a valid denominator. No event means `NO_DATA`, not zero;
one person or one conversation is insufficient for trend claims.

## 7. Privacy and permissions

Use the minimum identity reference needed for lifecycle correlation. Store no
academic private data, transcript, message body or unneeded PII. Keep public
catalog facts separate from person state. Retention and recommendation
outputs are read-only until a future authorization specifies channel,
consent, operator and audit requirements.

## 8. Acceptance criteria for Gate 10 foundation

- `RETENTION_STATE_MACHINE_V1 = PASS`.
- `NEXT_BEST_COURSE_CONTRACT_V1 = PASS`.
- `MINIMAL_IDENTITY_BRIDGE_CONTRACT = PASS`.
- `EVENT_MODEL = PASS`.
- `PRIVACY_BOUNDARY = PASS`.
- `NETROOM_READS = 0` and `NETROOM_MUTATIONS = 0`.
- `PROD_MUTATIONS = 0`.
- Gate 09 continues collecting organic canonical events without runtime
  behavior changes.

## 9. Next implementation movement

Implement a Campus-only, read-only **Retention Eligibility Projection V1**:
consume only authorized lifecycle events already present in the Event Store,
show evidenced state and missing evidence, and expose no NETROOM data or
outbound action. Add the smallest contract test set before considering a Next
Best Course evaluator.
