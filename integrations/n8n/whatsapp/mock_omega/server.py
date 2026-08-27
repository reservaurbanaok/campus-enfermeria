import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DB_PATH = os.environ.get("OMEGA_MOCK_DB_PATH", "/data/omega_mock.sqlite")


def db():
    con = sqlite3.connect(DB_PATH)
    con.execute(
        "CREATE TABLE IF NOT EXISTS inbound (external_message_id TEXT PRIMARY KEY, correlation_id TEXT, processed_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS delivery_status (external_message_id TEXT PRIMARY KEY, status TEXT NOT NULL, correlation_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS technical_errors (error_code TEXT, correlation_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    return con


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return

    def send_json(self, status, payload):
        raw = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "healthy", "service": "omega-mock"})
            return
        if self.path == "/metrics":
            con = db()
            inbound = con.execute("SELECT COUNT(*), COALESCE(SUM(processed_count), 0) FROM inbound").fetchone()
            statuses = con.execute("SELECT COUNT(*) FROM delivery_status").fetchone()[0]
            errors = con.execute("SELECT COUNT(*) FROM technical_errors").fetchone()[0]
            con.close()
            self.send_json(200, {"inbound_unique": inbound[0], "logical_processing": inbound[1], "delivery_status": statuses, "technical_errors": errors})
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self):
        try:
            payload = self.read_json()
            con = db()
            if self.path == "/v1/channel/ingress":
                message_id = payload.get("external_message_id")
                correlation_id = payload.get("correlation_id")
                if not message_id or payload.get("channel") != "whatsapp":
                    con.close()
                    self.send_json(400, {"status": "rejected", "error_code": "invalid_normalized_payload"})
                    return
                row = con.execute("SELECT processed_count FROM inbound WHERE external_message_id=?", (message_id,)).fetchone()
                if row:
                    self.send_json(200, {"status": "deduplicated", "logical_processing": row[0], "response_type": "no_reply", "correlation_id": correlation_id})
                else:
                    con.execute("INSERT INTO inbound(external_message_id, correlation_id, processed_count) VALUES (?, ?, 1)", (message_id, correlation_id))
                    con.commit()
                    handoff_requested = payload.get("message", {}).get("text") in {"synthetic_handoff", "human_requested"}
                    response = {"status": "processed", "logical_processing": 1, "response_type": "text", "text": "OMEGA_STAGING_MOCK_RESPONSE", "correlation_id": correlation_id, "handoff_state": "gate_05_reused" if handoff_requested else "none"}
                    if handoff_requested:
                        response["handoff_packet"] = {"owner": "OMEGA_GATE_05", "channel": "whatsapp", "synthetic": True}
                    self.send_json(200, response)
                con.close()
                return
            if self.path == "/v1/channel/status":
                message_id = payload.get("external_message_id")
                status = payload.get("status")
                if not message_id or not status:
                    con.close()
                    self.send_json(400, {"status": "rejected", "error_code": "invalid_status_payload"})
                    return
                con.execute("INSERT OR REPLACE INTO delivery_status(external_message_id, status, correlation_id) VALUES (?, ?, ?)", (message_id, status, payload.get("correlation_id")))
                con.commit()
                con.close()
                self.send_json(200, {"status": "audited", "channel": "whatsapp", "correlation_id": payload.get("correlation_id")})
                return
            if self.path == "/v1/technical-errors":
                con.execute("INSERT INTO technical_errors(error_code, correlation_id) VALUES (?, ?)", (payload.get("error_code", "unknown"), payload.get("correlation_id")))
                con.commit()
                con.close()
                self.send_json(202, {"status": "recorded", "technical_only": True})
                return
            con.close()
            self.send_json(404, {"error": "not_found"})
        except (ValueError, json.JSONDecodeError, sqlite3.Error):
            self.send_json(400, {"status": "rejected", "error_code": "malformed_payload"})


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 8787), Handler).serve_forever()


