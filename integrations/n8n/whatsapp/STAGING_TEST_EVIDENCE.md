# Gate 07 / Movement 07B — staging evidence

Date: 2026-08-26

## Environment

- n8n image: `docker.n8n.io/n8nio/n8n:1.123.5`
- editor binding: `127.0.0.1:5687` (local only)
- OMEGA target: `omega-mock:8787` on the private Compose network
- persistence: named volumes `omega-gate07-n8n-data` and `omega-gate07-omega-mock-data`
- no Meta credentials, WhatsApp number, webhook, or production asset is configured

## Synthetic checks

- A health check returned HTTP 200 from the OMEGA mock.
- A synthetic inbound message returned `processed` with `logical_processing=1`.
- Replaying the same `external_message_id` returned `deduplicated` and did not increment logical processing.
- A synthetic delivery status returned `audited`.
- A synthetic technical error returned `recorded` with `technical_only=true`.
- Mock metrics after the checks: `inbound_unique=1`, `logical_processing=1`, `delivery_status=1`, `technical_errors=1`.

## Recovery and project ownership

Docker Desktop recovered with context `desktop-linux`, Docker Engine 29.7.2, Linux kernel WSL2, and API availability confirmed by `docker version` and `docker info`.

The real n8n SQLite schema was inspected. The valid project is the personal project created for the local staging owner. The relevant tables are `project`, `project_relation`, `workflow_entity`, `workflow_history`, and `shared_workflow`. WF01, WF02, and WF03 each have a `shared_workflow` row with role `workflow:owner` for that project. No direct SQLite mutation was used and therefore no SQLite backup was required for the assignment step.

The exact original activation failure was caused by imported workflows having no project/share relation and no workflow history. The supported recovery was: create the local n8n owner/project bootstrap, save each workflow through the authenticated n8n REST API (`PATCH /rest/workflows/:id`) to create workflow history, then activate through the authenticated n8n REST API (`POST /rest/workflows/:id/activate`).

WF01 and WF02 are active. WF03 remains inactive by design because n8n 1.123.5 treats an `Error Trigger` workflow as an Error Workflow referenced from another workflow, not as an independently startable webhook workflow. WF03 is configured as the `errorWorkflow` for WF01 and WF02; this is the supported operational mode.

## QA after recovery

- WF01 webhook inbound returned a technical audit response and reached OMEGA staging.
- Replaying the same `external_message_id` kept `logical_processing=1` for that message.
- WF02 webhook delivery status returned `audited`.
- Malformed inbound payload was rejected with HTTP 500 by the protected workflow path; no logical processing was recorded.
- With the OMEGA mock stopped, WF01 returned HTTP 500; the mock was restarted and remained healthy.
- Mock persistence contains only synthetic `external_message_id`, `correlation_id`, `processed_count`, and timestamps; no sender or message text was stored.
- A malformed WF01 request produced a controlled source failure and invoked WF03; the technical evidence row contained only the error classification and correlation identifier.
- A synthetic `synthetic_handoff` message through WF01 reached OMEGA staging. The staging contract returned `handoff_state=gate_05_reused` and a synthetic packet owned by `OMEGA_GATE_05`; no second n8n handoff concept was created.
- No academic fields, real student data, real WhatsApp messages, Meta assets, or production endpoints were involved.

## Scope proof

No NETROOM files, production services, Meta assets, student records, academic events, or application code were changed by the staging checks.


