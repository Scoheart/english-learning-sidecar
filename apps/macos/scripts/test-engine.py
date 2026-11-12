#!/usr/bin/env python3
"""Smoke tests of the packaged engine with temporary data; no real API calls."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from threading import Thread
import time
import unittest
import urllib.request

ENGINE = Path(sys.argv.pop(1)).resolve()

def spawn(directory, port):
    return subprocess.Popen([str(ENGINE / "runtime/node"), str(ENGINE / "engine-entry.mjs")],
        env={**{key: value for key, value in os.environ.items() if not key.startswith("LEARNING_")},
             "SIDECAR_DATA_DIR": directory, "SIDECAR_PORT": str(port)},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def stop(process):
    if process.poll() is None:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
    process.stdout.close(); process.stderr.close()

def api(port, route, body=None, method=None, headers=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}{route}",
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **(headers or {})},
        method=method,
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.load(response)


def wait_for(check):
    for _ in range(50):
        try:
            if result := check():
                return result
        except OSError:
            pass
        time.sleep(.1)
    raise AssertionError("Packaged engine did not reach the expected state")


class ModelFixture(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/v1/chat/completions" or self.headers.get("Authorization"):
            self.send_error(400)
            return
        self.rfile.read(int(self.headers["Content-Length"]))
        lesson = {"translation": "I would like to explain this more clearly."}
        response = {"choices": [{"message": {"content": json.dumps(lesson)}}]}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, *_args):
        pass


class EngineTests(unittest.TestCase):
    def test_packaged_start_and_graceful_exit(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket() as reserve:
            reserve.bind(("127.0.0.1", 0)); port = reserve.getsockname()[1]; reserve.close()
            process = spawn(directory, port)
            try:
                result = None
                for _ in range(50):
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/status", timeout=1) as response:
                            result = json.load(response); break
                    except OSError: time.sleep(.1)
                self.assertIsNotNone(result, "Packaged service never started")
                self.assertEqual(result["mode"], "unconfigured")
                self.assertTrue(Path(directory, "ingest-token").exists())
                self.assertTrue(Path(directory, "sidecar.sqlite").exists())
                process.terminate(); process.wait(timeout=5)
                self.assertEqual(process.returncode, 0)
                self.assertFalse(Path(directory, "native-engine.lock").exists())
            finally: stop(process)

    def test_first_model_test_and_save_resume_queue_without_restart(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket() as reserve, \
                ThreadingHTTPServer(("127.0.0.1", 0), ModelFixture) as provider:
            reserve.bind(("127.0.0.1", 0))
            port = reserve.getsockname()[1]
            reserve.close()
            provider_thread = Thread(target=provider.serve_forever, daemon=True)
            provider_thread.start()
            process = spawn(directory, port)
            try:
                self.assertEqual(wait_for(lambda: api(port, "/api/status"))["mode"], "unconfigured")
                model_id = api(port, "/api/models")["activeTextId"]
                token = Path(directory, "ingest-token").read_text().strip()
                api(port, "/api/events", {"source": "codex", "content": "帮我解释这个概念"},
                    headers={"X-Sidecar-Token": token})
                self.assertEqual(api(port, "/api/events")["events"][0]["status"], "pending")
                draft = {"name": "Fixture", "kind": "text", "model": "fixture", "authMode": "none",
                         "baseUrl": f"http://127.0.0.1:{provider.server_port}/v1"}
                result = api(port, "/api/models/test", {"id": model_id, **draft})
                self.assertEqual(result["translation"], "I would like to explain this more clearly.")
                self.assertEqual(api(port, "/api/status")["mode"], "unconfigured")
                self.assertEqual(len(api(port, "/api/events")["events"]), 1)
                api(port, f"/api/models/{model_id}", draft, method="PATCH")
                self.assertEqual(api(port, "/api/status")["mode"], "live")
                wait_for(lambda: api(port, "/api/events")["events"][0]["status"] == "complete")
                self.assertIsNone(process.poll())
            finally:
                stop(process)
                provider.shutdown()
                provider_thread.join()

    def test_foreign_listener_is_not_killed_or_database_opened(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket() as listener:
            listener.bind(("127.0.0.1", 0)); listener.listen()
            process = spawn(directory, listener.getsockname()[1])
            try:
                process.wait(timeout=5)
                self.assertEqual(process.returncode, 1)
                self.assertFalse(Path(directory, "sidecar.sqlite").exists())
                self.assertFalse(Path(directory, "native-engine.lock").exists())
                with socket.create_connection(listener.getsockname(), timeout=1): pass
            finally: stop(process)

unittest.main()
