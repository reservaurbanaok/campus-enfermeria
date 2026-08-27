# Gate 07 — n8n staging foundation

This directory contains the non-production, synthetic foundation for the WhatsApp channel adapter. It is not connected to Meta, a real WhatsApp number, production, NETROOM, or academic data.

## Scope

- Pinned self-hosted n8n image: `docker.n8n.io/n8nio/n8n:1.123.5`.
- Local-only editor binding: `127.0.0.1:5687`.
- Persistent named volumes for n8n and the OMEGA mock.
- Synthetic OMEGA channel ingress mock with SQLite deduplication.
- Three exported, inactive workflows: inbound, delivery status and technical error handling.

## Start

Create a local environment file outside Git from `env.example`, or export the three variables in the shell. Never put real Meta credentials, WABA IDs, phone numbers, tokens or encryption keys in this directory.

```powershell
docker compose --env-file .env up -d
docker compose ps
```

The editor is local at `http://127.0.0.1:5687`. The mock health endpoint is internal to the Compose network at `http://omega-mock:8787/health`.

Import the three JSON definitions through the n8n editor or the n8n workflow import command. Keep them inactive during foundation tests unless the local test explicitly needs webhook execution.

## Synthetic checks

WF-01 accepts a normalized mock payload at `/webhook/gate07/whatsapp/inbound/mock`. The OMEGA mock persists only the external message ID, correlation ID and logical count. Replaying the same ID returns `deduplicated` and does not increase logical processing.

WF-02 accepts delivery status and records technical status only.

WF-03 records technical error evidence only. It does not create a semantic Handoff; Gate 05 remains Core-owned.

## Security baseline

- Basic authentication is enabled for the local editor.
- Encryption key and editor password are runtime secrets outside Git.
- No public port, HTTPS endpoint or Meta webhook is configured.
- Successful execution data is not retained; error executions are retained for controlled debugging and pruning is enabled.
- n8n has no NETROOM network, DB, session, academic or service-role credential.

## Stop / rollback

```powershell
docker compose down
```

Rollback is deactivating/removing the three inactive workflows and stopping this isolated Compose project. Do not remove named volumes as part of normal rollback; retain them only for synthetic evidence and delete them through an explicitly authorized cleanup operation.

## Next movement

`07C — Meta WhatsApp Cloud API test integration`, after Owner review of this foundation and explicit approval of synthetic Meta staging assets.


