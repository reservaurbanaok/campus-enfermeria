"""Pure, testable Meta WhatsApp adapter primitives for WF04 staging.

The n8n export is the runtime adapter. This module keeps signature, parsing,
normalization and outbound construction deterministic for offline QA; it has
no network calls, persistence, credentials or Meta side effects.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import datetime, timezone

EXPECTED_OBJECT = "whatsapp_business_account"
EXPECTED_PHONE_NUMBER_ID = "1061851020353611"
SUPPORTED_STATUSES = frozenset({"sent", "delivered", "read", "failed"})
SUPPORTED_MESSAGE_TYPES = frozenset({"text"})
OMEGA_SCHEMA_VERSION = "OMEGA_CHANNEL_MESSAGE_V1"


class MetaAdapterError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def verify_meta_signature(body: bytes, supplied: str, app_secret: str) -> bool:
    if not app_secret or not supplied or not supplied.startswith("sha256="):
        return False
    digest = supplied[7:]
    if len(digest) != 64 or any(c not in "0123456789abcdefABCDEF" for c in digest):
        return False
    expected = hmac.new(app_secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, digest.lower())


def _timestamp(value) -> str:
    try:
        stamp = float(value)
        return datetime.fromtimestamp(stamp, timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, OverflowError):
        raise MetaAdapterError("invalid_timestamp", "Meta timestamp inválido") from None


def _correlation(entry_id: str, external_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"omega-meta:{entry_id}:{external_id}"))


def parse_meta_payload(payload: dict, *, expected_phone_number_id: str = EXPECTED_PHONE_NUMBER_ID) -> list[dict]:
    if not isinstance(payload, dict) or payload.get("object") != EXPECTED_OBJECT:
        raise MetaAdapterError("malformed_payload", "Objeto Meta inválido")
    entries = payload.get("entry")
    if not isinstance(entries, list) or not entries:
        raise MetaAdapterError("malformed_payload", "Falta entry")

    events = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("changes"), list):
            raise MetaAdapterError("malformed_payload", "entry/ch changes inválido")
        entry_id = str(entry.get("id") or "")
        for change in entry["changes"]:
            if not isinstance(change, dict) or change.get("field") != "messages":
                continue
            value = change.get("value")
            if not isinstance(value, dict) or not isinstance(value.get("metadata"), dict):
                raise MetaAdapterError("malformed_payload", "value/metadata inválido")
            metadata = value["metadata"]
            phone_number_id = str(metadata.get("phone_number_id") or "")
            if phone_number_id != expected_phone_number_id:
                raise MetaAdapterError("wrong_phone_number", "Phone Number ID no permitido")
            display_phone_number = str(metadata.get("display_phone_number") or "")
            contacts = value.get("contacts") or []
            contacts_by_wa_id = {
                str(contact.get("wa_id")): contact
                for contact in contacts if isinstance(contact, dict) and contact.get("wa_id")
            }

            for status in value.get("statuses") or []:
                if not isinstance(status, dict) or status.get("status") not in SUPPORTED_STATUSES:
                    raise MetaAdapterError("unsupported_status", "Status Meta no soportado")
                external_id = str(status.get("id") or "")
                if not external_id or not status.get("recipient_id") or status.get("timestamp") is None:
                    raise MetaAdapterError("malformed_status", "Status Meta incompleto")
                events.append({
                    "kind": "status",
                    "schema_version": "OMEGA_CHANNEL_STATUS_V1",
                    "channel": "whatsapp",
                    "status": status["status"],
                    "wamid": external_id,
                    "external_message_id": external_id,
                    "recipient_id": str(status["recipient_id"]),
                    "timestamp": _timestamp(status["timestamp"]),
                    "correlation_id": _correlation(entry_id, external_id),
                    "phone_number_id": phone_number_id,
                })

            for message in value.get("messages") or []:
                if not isinstance(message, dict):
                    raise MetaAdapterError("malformed_message", "Message Meta inválido")
                external_id = str(message.get("id") or "")
                actor_id = str(message.get("from") or "")
                message_type = message.get("type")
                if not external_id or not actor_id or message.get("timestamp") is None:
                    raise MetaAdapterError("malformed_message", "Message Meta incompleto")
                if message_type not in SUPPORTED_MESSAGE_TYPES:
                    events.append({
                        "kind": "unsupported",
                        "channel": "whatsapp",
                        "external_message_id": external_id,
                        "external_actor_id": actor_id,
                        "message_type": message_type or "unknown",
                        "phone_number_id": phone_number_id,
                        "correlation_id": _correlation(entry_id, external_id),
                        "response_text": "Por ahora puedo procesar mensajes de texto. Escribime tu consulta en un mensaje de texto.",
                    })
                    continue
                text = message.get("text")
                if not isinstance(text, dict) or not isinstance(text.get("body"), str) or not text["body"].strip():
                    raise MetaAdapterError("malformed_message", "Mensaje de texto sin body")
                contact = contacts_by_wa_id.get(actor_id, {})
                events.append({
                    "kind": "text",
                    "schema_version": OMEGA_SCHEMA_VERSION,
                    "channel": "whatsapp",
                    "external_message_id": external_id,
                    "external_actor_id": actor_id,
                    "wa_id": str(contact.get("wa_id") or actor_id),
                    "message_type": "text",
                    "text": text["body"].strip()[:500],
                    "received_at": _timestamp(message["timestamp"]),
                    "correlation_id": _correlation(entry_id, external_id),
                    "channel_metadata": {
                        "provider": "meta_cloud_api",
                        "phone_number_id": phone_number_id,
                        "display_phone_number": display_phone_number,
                    },
                })
    if not events:
        raise MetaAdapterError("no_supported_event", "Webhook sin evento messages/status")
    return events


def build_omega_request(event: dict, *, secret: str, timestamp: str, nonce: str) -> tuple[bytes, dict]:
    if event.get("kind") != "text":
        raise MetaAdapterError("not_omega_text", "Sólo texto entra a OMEGA")
    payload = {key: event[key] for key in (
        "schema_version", "channel", "external_message_id", "external_actor_id",
        "message_type", "text", "received_at", "correlation_id", "channel_metadata",
    )}
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    signing_input = timestamp.encode() + b"\n" + nonce.encode() + b"\n" + body
    signature = hmac.new(secret.encode(), signing_input, hashlib.sha256).hexdigest()
    return body, {
        "X-Omega-Service": "n8n-whatsapp-staging",
        "X-Omega-Timestamp": timestamp,
        "X-Omega-Nonce": nonce,
        "X-Omega-Signature": signature,
        "X-Omega-Idempotency-Key": event["external_message_id"],
    }


def build_meta_outbound(*, phone_number_id: str, recipient: str,
                        response_text: str, access_token: str,
                        capture_base_url: str) -> dict:
    if not access_token or not capture_base_url:
        raise MetaAdapterError("outbound_not_configured", "Outbound staging no configurado")
    path = f"/v25.0/{phone_number_id}/messages"
    graph_url = f"https://graph.facebook.com{path}"
    return {
        "method": "POST",
        "url": capture_base_url.rstrip("/") + path,
        "graph_url": graph_url,
        "headers": {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        "json": {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "text",
            "text": {"body": response_text},
        },
    }


