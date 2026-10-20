#!/usr/bin/env python3
"""Bridge UXE taste gate to the standalone ai-detector skill."""
import json
import os
import subprocess
import sys
from pathlib import Path

DEFAULT_THRESHOLD = 85
DEFAULT_FORBIDDEN = {"TELL-L14"}


def _detector_path():
    candidates = [
        os.environ.get("UXE_AI_DETECTOR"),
        Path.home() / ".claude/skills/ai-detector/scripts/ai-detect.py",
        Path.home() / "Library/Mobile Documents/com~apple~CloudDocs/Documents/Obsidian/skills/ai-detector/scripts/ai-detect.py",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)
    return None


def _policy(root):
    path = root / ".uxe" / "checks.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        cfg = data.get("taste_ai_detector", {})
    except Exception:
        cfg = {}
    threshold = int(cfg.get("threshold", DEFAULT_THRESHOLD))
    forbidden = set(cfg.get("forbidden_rules", sorted(DEFAULT_FORBIDDEN)))
    return threshold, forbidden


def _rel(root, value):
    try:
        return str(Path(value).resolve().relative_to(root))
    except Exception:
        return str(value)


def _add(issues, issue_id, path, detail, evidence=""):
    issues.append({"id": issue_id, "path": path, "detail": detail, "evidence": str(evidence)[:240]})


def _entries(stdout):
    data = json.loads(stdout or "[]")
    return data if isinstance(data, list) else [data]


def _entry_issues(root, entry, threshold, forbidden):
    issues, file_path = [], _rel(root, entry.get("file", ""))
    score = int(entry.get("score", 100))
    if score < threshold:
        _add(issues, "TASTE_AI_DETECTOR_SCORE", file_path, f"ai-detector score {score} < {threshold}")
    if entry.get("has_critical"):
        _add(issues, "TASTE_AI_DETECTOR_CRITICAL", file_path, "ai-detector reported critical findings")
    for finding in entry.get("findings", []):
        rule = finding.get("rule", "")
        if rule in forbidden:
            _add(issues, "TASTE_AI_DETECTOR_RULE", file_path, f"forbidden ai-detector rule {rule}", finding.get("detail", ""))
    return issues


def ai_detector_issues(root, html_paths):
    html_paths = [Path(path) for path in html_paths if Path(path).suffix.lower() == ".html"]
    if not html_paths:
        return []
    detector = _detector_path()
    if not detector:
        return [{"id": "TASTE_AI_DETECTOR_UNAVAILABLE", "path": ".", "detail": "ai-detector skill script not found", "evidence": ""}]
    threshold, forbidden = _policy(root)
    cmd = [sys.executable, str(detector), "--format", "json", "--threshold", str(threshold), *map(str, html_paths)]
    result = subprocess.run(cmd, text=True, capture_output=True, timeout=30)
    try:
        entries = _entries(result.stdout)
    except Exception as exc:
        return [{"id": "TASTE_AI_DETECTOR_UNREADABLE", "path": ".", "detail": str(exc), "evidence": result.stderr[-240:]}]
    issues = [issue for entry in entries for issue in _entry_issues(root, entry, threshold, forbidden)]
    if result.returncode not in (0, 1, 2) and not issues:
        return [{"id": "TASTE_AI_DETECTOR_ERROR", "path": ".", "detail": f"ai-detector exited {result.returncode}", "evidence": result.stderr[-240:]}]
    return issues
