#!/usr/bin/env python3
"""Codex lifecycle adapter for the agent-neutral fablize brain recorder."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

from brain_reflect import record_payload, state_root


def state_path(payload):
    cwd = payload.get("cwd") or str(Path.cwd())
    session = re.sub(r"[^A-Za-z0-9_.-]", "_", str(payload.get("session_id") or "unknown"))
    return state_root(cwd) / ".fablize" / ".sessions" / f"codex-{session}.json"


def private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main():
    try:
        payload = json.load(sys.stdin)
    except (OSError, ValueError):
        return 0
    if not isinstance(payload, dict):
        return 0

    event = payload.get("hook_event_name")
    path = state_path(payload)
    try:
        if event == "UserPromptSubmit":
            prompt = str(payload.get("prompt") or "").strip()
            if prompt:
                private_write(path, {"prompt": prompt[:2000]})
            return 0
        if event != "Stop" or payload.get("stop_hook_active"):
            return 0
        if path.exists():
            try:
                payload["prompt"] = json.loads(path.read_text(encoding="utf-8")).get("prompt", "")
            except (OSError, ValueError, AttributeError):
                pass
        record_payload(payload)
    except OSError:
        pass
    finally:
        if event == "Stop":
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
