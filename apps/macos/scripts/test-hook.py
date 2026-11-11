#!/usr/bin/env python3
"""Integration checks for the actual compiled native Hook helper; no model calls."""
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest

BINARY = str(Path(sys.argv.pop(1)).resolve())

class NativeHookTests(unittest.TestCase):
    def run_hook(self, agent, data, directory, port=1):
        start = time.monotonic()
        result = subprocess.run([BINARY, agent, str(port)], input=data, capture_output=True,
                                env={**os.environ, "SIDECAR_DATA_DIR": directory}, timeout=3)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stderr, b"")
        self.assertLess(time.monotonic() - start, 2)
        return result.stdout

    def test_missing_service_is_fail_open_for_all_agents(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "ingest-token").write_text("a" * 64)
            for agent in ("codex", "claude", "cursor", "grok"):
                output = self.run_hook(agent, b'{"prompt":"Analyze this request."}', directory)
                self.assertEqual(output, b'{"continue":true}\n' if agent == "cursor" else b"")

    def test_invalid_json_missing_token_and_oversized_input(self):
        with tempfile.TemporaryDirectory() as directory:
            for data in (b"invalid", b'{"prompt":"test"}', b"x" * 140000):
                self.assertEqual(self.run_hook("cursor", data, directory), b'{"continue":true}\n')

    def test_real_delivery_preserves_ids_and_never_prints_lesson(self):
        received = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((self.path, self.headers.get("x-sidecar-token"), json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
                self.send_response(202); self.end_headers(); self.wfile.write(b'{"lesson":"MUST NOT APPEAR IN STDOUT"}')
            def log_message(self, *_): pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                Path(directory, "ingest-token").write_text("b" * 64)
                output = self.run_hook("grok", b'{"prompt":"Explain this.","session_id":"s1","turn_id":"t1"}', directory, server.server_port)
                self.assertEqual(output, b"")
                self.assertEqual(len(received), 1)
                path, token, body = received[0]
                self.assertEqual(path, "/api/events"); self.assertEqual(token, "b" * 64)
                self.assertEqual(body["sessionId"], "s1"); self.assertEqual(body["turnId"], "t1")
                self.assertEqual(body["source"], "grok"); self.assertEqual(body["content"], "Explain this.")
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_stalled_stdin_is_bounded(self):
        process = subprocess.Popen([BINARY, "cursor"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            process.wait(timeout=2)
            self.assertEqual(process.returncode, 0)
            self.assertEqual(process.stdout.read(), b'{"continue":true}\n')
        finally:
            if process.poll() is None: process.kill()
            process.stdin.close(); process.stdout.close(); process.stderr.close()

unittest.main()
