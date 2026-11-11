#!/usr/bin/env python3
"""Smoke tests of the packaged engine with temporary data; no real API calls."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ENGINE = Path(sys.argv.pop(1)).resolve()

def spawn(directory, port):
    return subprocess.Popen([str(ENGINE / "runtime/node"), str(ENGINE / "engine-entry.mjs")],
        env={**os.environ, "SIDECAR_DATA_DIR": directory, "SIDECAR_PORT": str(port), "LEARNING_API_KEY": ""},
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def stop(process):
    if process.poll() is None:
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
    process.stdout.close(); process.stderr.close()

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
                self.assertEqual(result["mode"], "demo")
                self.assertTrue(Path(directory, "ingest-token").exists())
                self.assertTrue(Path(directory, "sidecar.sqlite").exists())
                process.terminate(); process.wait(timeout=5)
                self.assertEqual(process.returncode, 0)
                self.assertFalse(Path(directory, "native-engine.lock").exists())
            finally: stop(process)

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
