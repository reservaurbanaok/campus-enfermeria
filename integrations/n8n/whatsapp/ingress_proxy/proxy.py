"""Restricted staging ingress for Gate 07C.1.

Only the two synthetic webhook paths are exposed. The n8n editor, REST API,
credentials, and all other paths are deliberately denied.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import http.client
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit


ALLOWED_PATHS = {
    "/webhook/gate07/whatsapp/inbound/mock",
    "/webhook/gate07/whatsapp/status/mock",
    "/webhook/gate07/whatsapp/inbound/real",
    "/webhook/gate07/whatsapp/status/real",
}
REAL_META_PATHS = {
    "/webhook/gate07/whatsapp/inbound/real",
    "/webhook/gate07/whatsapp/status/real",
}
CHALLENGE_PATHS = ALLOWED_PATHS | {"/"}
MAX_BODY_BYTES = 1024 * 1024


def verify_meta_signature(body: bytes, supplied: str, app_secret: str) -> bool:
    """Verify Meta's X-Hub-Signature-256 without logging the secret/body."""
    if not app_secret or not supplied or not supplied.startswith("sha256="):
        return False
    digest = supplied[7:]
    if len(digest) != 64 or any(c not in "0123456789abcdefABCDEF" for c in digest):
        return False
    expected = hmac.new(app_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, digest.lower())


def parse_listen(value: str) -> tuple[str, int]:
    host, separator, port_text = value.rpartition(":")
    if not separator or not host or not port_text.isdigit():
        raise ValueError("listen must be HOST:PORT")
    port = int(port_text)
    if not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    return host, port


def validate_upstream(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise ValueError("upstream must be an HTTP loopback URL")
    if parsed.path.rstrip("/") not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("upstream must not contain a path, query, or fragment")
    return value.rstrip("/")


class RestrictedIngress(BaseHTTPRequestHandler):
    server_version = "Gate07CIngress/1.0"

    def safe_path(self) -> str:
        return urlsplit(self.path).path

    def log_message(self, format: str, *args: object) -> None:
        # Never log query strings, headers, bodies, or credentials.
        print(f"{self.command} {self.safe_path()} {args[1] if len(args) > 1 else '-'}", flush=True)

    def deny(self) -> None:
        self.send_response(404)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        if self.safe_path() not in CHALLENGE_PATHS:
            self.deny()
            return

        query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
        mode = query.get("hub.mode", [""])[0]
        supplied_token = query.get("hub.verify_token", [""])[0]
        challenge = query.get("hub.challenge", [""])[0]
        expected_token = os.environ.get("N8N_WEBHOOK_VERIFY_TOKEN", "")
        if mode != "subscribe" or not expected_token or supplied_token != expected_token:
            self.send_response(403)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        body = challenge.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.safe_path() not in ALLOWED_PATHS:
            self.deny()
            return

        content_length = self.headers.get("Content-Length")
        try:
            body_length = int(content_length or "-1")
        except ValueError:
            body_length = -1
        if body_length < 0 or body_length > MAX_BODY_BYTES:
            self.send_response(413 if body_length > MAX_BODY_BYTES else 400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return

        body = self.rfile.read(body_length)
        if self.safe_path() in REAL_META_PATHS:
            app_secret = os.environ.get("META_APP_SECRET", "")
            signature = self.headers.get("X-Hub-Signature-256", "")
            if not verify_meta_signature(body, signature, app_secret):
                self.send_response(403)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        parsed_request = urlsplit(self.path)
        upstream = self.server.upstream
        upstream_url = urlsplit(upstream)
        forward_path = urlunsplit(("", "", parsed_request.path, parsed_request.query, ""))
        connection = http.client.HTTPConnection(
            upstream_url.hostname,
            upstream_url.port or 80,
            timeout=15,
        )
        try:
            connection.request(
                "POST",
                forward_path,
                body=body,
                headers={
                    "Content-Type": self.headers.get("Content-Type", "application/json"),
                    "Content-Length": str(len(body)),
                    "X-Forwarded-Proto": "https",
                },
            )
            response = connection.getresponse()
            response_body = response.read(MAX_BODY_BYTES)
            self.send_response(response.status)
            content_type = response.getheader("Content-Type")
            if content_type:
                self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
        except (OSError, http.client.HTTPException):
            self.send_response(502)
            self.send_header("Content-Length", "0")
            self.end_headers()
        finally:
            connection.close()

    def do_PUT(self) -> None:
        self.deny()

    def do_PATCH(self) -> None:
        self.deny()

    def do_DELETE(self) -> None:
        self.deny()

    def do_OPTIONS(self) -> None:
        self.deny()

    def do_HEAD(self) -> None:
        self.deny()


class IngressServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], upstream: str):
        super().__init__(address, RestrictedIngress)
        self.upstream = upstream


def main() -> None:
    parser = argparse.ArgumentParser(description="Gate 07C restricted webhook ingress")
    parser.add_argument("--listen", default="127.0.0.1:8080")
    parser.add_argument("--upstream", default="http://127.0.0.1:5687")
    args = parser.parse_args()
    address = parse_listen(args.listen)
    upstream = validate_upstream(args.upstream)
    if not os.environ.get("N8N_WEBHOOK_VERIFY_TOKEN"):
        raise SystemExit("N8N_WEBHOOK_VERIFY_TOKEN is required and stays outside Git")
    server = IngressServer(address, upstream)
    print(f"restricted ingress listening on {address[0]}:{address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()


