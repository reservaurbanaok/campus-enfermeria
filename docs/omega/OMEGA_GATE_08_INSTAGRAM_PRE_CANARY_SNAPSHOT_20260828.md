# OMEGA Gate 08 — pre-canary Meta snapshot

Snapshot read-only captured before any Meta mutation.

## Scope

- Active Meta App: `4382588185329556` — Campus Enfermeria Asistente.
- Instagram API sub-App shown by the Instagram use case: `4296194637360399`.
- Instagram account: `@campus.enfermeria`.
- Instagram User ID: `17841433759878333`.
- Linked Facebook Page ID: `1026618000543967`.
- Historical App `993816439997545`: not active in the current app list and not targeted.

## Current callback

The Instagram use-case webhook configuration currently shows:

`https://us-central1-project-976033f5-04a7-440e-935.cloudfunctions.net/whatsapp-webhook`

Verify-token status/reference: STAGING configuration reference exists as
`META_VERIFY_TOKEN`; the value was not read or printed.

## Current Instagram webhook fields

Subscribed: `comments`, `live_comments`, `message_edit`,
`message_reactions`, `messages`, `messaging_postbacks`,
`messaging_referral`, `messaging_seen`.

Canceled: `messaging_handover`, `messaging_optins`, `standby`.

Relevant messaging permissions were visible as ready for testing in the
authenticated Meta configuration. No permission, token, app, Page or account
was changed during this snapshot.

## Deterministic rollback

- Restore the exact callback URL above in the same Instagram use-case
  configuration.
- Restore the exact subscribed/canceled field sets above.
- Do not alter the WhatsApp use case, WABA routing, WF04 or App
  `993816439997545`.

This snapshot contains no token, secret or credential value.
