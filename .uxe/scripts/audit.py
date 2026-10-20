#!/usr/bin/env python3
"""Project-local UXE aggregate audit gate."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


REQUIRED = ["contract.json", "surfaces.json", "token-map.json", "checks.json", "checklist.md"]


def load_json(root, name):
    path = root / ".uxe" / name
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def run_script(script, root):
    result = subprocess.run([sys.executable, str(script), "--project-root", str(root)], text=True, capture_output=True)
    return {"command": script.name, "returncode": result.returncode, "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}


def page_capability_script(root, scripts):
    local = scripts / "page-capability.py"
    if local.exists():
        return local
    if (root / ".uxe" / "page-capability-manifest.json").exists():
        return Path(__file__).resolve().parent / "uxe_gate_page_capability.py"
    return None


def required_files(root):
    return [name for name in REQUIRED if not (root / ".uxe" / name).exists()]


def contract_issues(root):
    contract = load_json(root, "contract.json") or {}
    issues = []
    if not contract.get("product_mode"):
        issues.append("missing_product_mode")
    if not contract.get("target_style"):
        issues.append("missing_target_style")
    if not contract.get("typography", {}).get("scale"):
        issues.append("missing_typography_scale")
    if not contract.get("theme", {}).get("local_aliases"):
        issues.append("missing_token_aliases")
    return issues


def surface_issues(root):
    surfaces = load_json(root, "surfaces.json") or {}
    items = surfaces.get("surfaces", [])
    issues = []
    if not items:
        issues.append("missing_surfaces")
    parity = surfaces.get("parity_groups", [])
    if any("editor" in item.get("id", "") for item in items) and not parity:
        issues.append("missing_editor_parity_group")
    return issues


def final_report_issues(root):
    checks = load_json(root, "checks.json") or {}
    required = set(checks.get("required_final_report", []))
    expected = {"selected_contract", "affected_surfaces", "affected_tokens", "checks_run", "known_deviations"}
    missing = sorted(expected - required)
    return [f"missing_final_report:{item}" for item in missing]


def main():
    parser = argparse.ArgumentParser(description="Run UXE aggregate audit.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--skip-visual", action="store_true")
    parser.add_argument("--allow-deviation", action="store_true")
    parser.add_argument("--deviation", default="", help="Required reason when skipping visual checks")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    scripts = root / ".uxe" / "scripts"
    failures = {
        "missing_files": required_files(root),
        "contract": contract_issues(root),
        "surfaces": surface_issues(root),
        "final_report": final_report_issues(root),
    }
    if args.skip_visual and not args.deviation.strip():
        failures["visual"] = ["skip_visual_requires_deviation"]
    elif args.skip_visual and os.environ.get("CI") and not args.allow_deviation:
        failures["visual"] = ["skip_visual_blocked_in_ci"]
    runs = [run_script(scripts / "check.py", root), run_script(scripts / "component.py", root), run_script(scripts / "taste.py", root), run_script(scripts / "contract.py", root)]
    page_script = page_capability_script(root, scripts)
    if page_script:
        runs.append(run_script(page_script, root))
    if not args.skip_visual:
        runs.append(run_script(scripts / "visual.py", root))
    failed_runs = [run for run in runs if run["returncode"] != 0]
    failures["commands"] = failed_runs
    failures = {key: value for key, value in failures.items() if value}
    if failures:
        print("UXE audit failed")
        print(json.dumps(failures, indent=2))
        return 1
    print("UXE audit passed")
    print(json.dumps({"commands": runs}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
