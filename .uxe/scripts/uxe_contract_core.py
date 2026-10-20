"""Core implementation for the project-local UXE contract gate."""
import argparse
import json
import re
from pathlib import Path

from uxe_contract_computed import computed_cascade_failures, computed_data, rendered_distance, terminal_font
from uxe_contract_css import VAR_DEF, VAR_USE, binding_satisfied, read, surface_text

STYLE_REQUIRED = {
    "ant-design": ["--btn-primary-bg", "--input-bg", "--table-header-bg", "--tag-info-bg", "--card-bg"],
    "material-design": ["--btn-primary-bg", "--card-shadow", "--shape-radius-lg", "--material-state-layer-opacity-hover", "--background-page"],
    "terminal-cli": ["--typo-family", "--background-page", "--card-border", "--btn-primary-bg", "--table-border"],
    "liquid-glass-dark": ["--material-backdrop-blur", "--overlay-backdrop", "--card-bg", "--card-shadow", "--shape-radius-lg"],
    "liquid-glass-light": ["--material-backdrop-blur", "--overlay-backdrop", "--card-bg", "--card-shadow", "--shape-radius-lg"],
}
GRAMMAR_PATTERNS = {
    "table": r"<table\b", "form": r"<form\b", "aside": r"<aside\b", "nav": r"<nav\b",
    "hero": r"\bhero(?:-|_|\b)", "card": r"\b(?:card|panel|tile)\b",
    "grid": r"\bgrid(?:-|_|\b)|grid-template-columns",
    "terminal": r"\b(?:terminal|console|command|shell|trace)\b",
    "editor": r"\b(?:editor|preview|document|viewer)\b",
    "commerce": r"\b(?:store|product|cart|filter|rating|shop)\b",
    "portfolio": r"\b(?:portfolio|project|skill|contact-form|selected-work)\b",
    "glass": r"\b(?:backdrop-filter|blur|overlay|glass)\b",
}
ALIAS_BRIDGES = {
    "--surface": ["--background-page", "--card-bg"], "--elevated": ["--card-bg", "--overlay-bg"],
    "--text": ["--input-text", "--statistic-value", "--table-header-text"],
    "--text-muted": ["--input-help", "--input-placeholder", "--statistic-title"],
    "--accent": ["--btn-primary-bg", "--nav-text-active"],
    "--border": ["--card-border", "--input-border", "--table-border"],
    "--focus-ring": ["--input-border-focus"],
    "--font-body": ["--typo-family"], "--font-mono": ["--typo-family"],
    "--radius": ["--shape-radius-md", "--shape-radius-sm", "--card-radius"],
}


def load_json(root, rel, default=None):
    path = root / rel
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def target_style(contract, surface):
    return surface.get("style_id") or contract.get("target_style") or "custom"


def required_tokens(contract, surface):
    required = list(STYLE_REQUIRED.get(target_style(contract, surface), []))
    required.extend(surface.get("required_token_usage") or [])
    contract_req = contract.get("required_token_usage") or []
    required.extend(contract_req if isinstance(contract_req, list) else [])
    return sorted({token for token in required if token.startswith("--")})


def consumed_tokens(text):
    return set(VAR_USE.findall(text))


def defined_tokens(text):
    return {token for token, _ in VAR_DEF.findall(text)}


def var_definitions(text):
    found = {}
    for token, value in VAR_DEF.findall(text):
        found.setdefault(token, []).append(value.strip())
    return found


def is_bridged(value, targets):
    return any(re.search(rf"var\(\s*{re.escape(target)}\b", value) for target in targets)


def token_family(token):
    return token[2:].split("-", 1)[0]


def grammar_profile(text):
    low = text.lower()
    profile = {key: len(re.findall(pattern, low, re.I)) for key, pattern in GRAMMAR_PATTERNS.items()}
    profile["token_families"] = ",".join(sorted({token_family(token) for token in consumed_tokens(text)}))
    return profile


def profile_distance(a, b):
    keys = [key for key in GRAMMAR_PATTERNS if max(a.get(key, 0), b.get(key, 0))]
    diffs = sum(abs(a.get(key, 0) - b.get(key, 0)) / max(a.get(key, 0), b.get(key, 0)) for key in keys)
    af, bf = set(a.get("token_families", "").split(",")), set(b.get("token_families", "").split(","))
    af.discard("")
    bf.discard("")
    return diffs + 1 - (len(af & bf) / max(1, len(af | bf)))


def surface_items(root, surfaces_data):
    return surfaces_data.get("surfaces", []) or [{"id": "project", "entry": ""}]


def token_failures(root, contract, surfaces_data):
    failures = []
    for surface in surface_items(root, surfaces_data):
        required = required_tokens(contract, surface)
        missing = [token for token in required if token not in consumed_tokens(surface_text(root, surface))]
        if missing:
            failures.append({"surface": surface.get("id", "project"), "missing": missing})
    return failures


def selector_binding_failures(root, surfaces_data):
    failures = []
    for surface in surface_items(root, surfaces_data):
        bindings = surface.get("token_bindings") or []
        missing = [item.get("role", "binding") for item in bindings if not binding_satisfied(surface_text(root, surface, broad=False), item)]
        if missing:
            failures.append({"surface": surface.get("id", "project"), "missing": missing})
    return failures


def needs_alias_gate(contract, surface):
    return target_style(contract, surface) in STYLE_REQUIRED or bool(surface.get("required_token_usage"))


def alias_collision_failures(root, contract, surfaces_data):
    failures = []
    for surface in surface_items(root, surfaces_data):
        if not needs_alias_gate(contract, surface):
            continue
        text, issues = surface_text(root, surface), []
        defs, known = var_definitions(text), consumed_tokens(text) | defined_tokens(text)
        for alias, targets in ALIAS_BRIDGES.items():
            active = [target for target in targets if target in known]
            if alias in defs and active and not any(is_bridged(value, active) for value in defs[alias]):
                issues.append({"alias": alias, "expected_bridge": active})
        if issues:
            failures.append({"surface": surface.get("id", "project"), "aliases": issues})
    return failures


def distinctness_failures(root, surfaces_data):
    surfaces = surface_items(root, surfaces_data)
    profiles = {item["id"]: grammar_profile(surface_text(root, item)) for item in surfaces if item.get("id")}
    rendered = {item["id"]: (computed_data(root, item["id"]) or {}).get("rendered_style_profile") for item in surfaces if item.get("id")}
    failures = []
    for surface in surfaces:
        sid = surface.get("id")
        for other in surface.get("distinct_from") or []:
            if sid not in profiles or other not in profiles:
                continue
            if rendered.get(sid) and rendered.get(other):
                distance, threshold, mode = rendered_distance(rendered[sid], rendered[other]), float(surface.get("rendered_distinctness_threshold", 1)), "rendered"
            else:
                distance, threshold, mode = profile_distance(profiles[sid], profiles[other]), float(surface.get("distinctness_threshold", 1.25)), "source"
            if distance is not None and distance < threshold:
                failures.append({"surface": sid, "distinct_from": other, "mode": mode, "distance": round(distance, 3)})
    return failures


def computed_contract_failures(root, contract, surfaces_data):
    failures = []
    for surface in surface_items(root, surfaces_data):
        if target_style(contract, surface) != "terminal-cli":
            continue
        data = computed_data(root, surface.get("id", ""))
        family = terminal_font(data) if data else ""
        if family and not any(name in family for name in ("mono", "menlo", "consolas", "courier")):
            failures.append({"surface": surface.get("id", "project"), "expected": "monospace", "actual": family})
    return failures


def main():
    parser = argparse.ArgumentParser(description="Run UXE contract consumption checks.")
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    contract = load_json(root, ".uxe/contract.json", {}) or {}
    surfaces = load_json(root, ".uxe/surfaces.json", {}) or {}
    failures = {
        "missing_required_token_usage": token_failures(root, contract, surfaces),
        "selector_token_binding_missing": selector_binding_failures(root, surfaces),
        "generic_alias_collision": alias_collision_failures(root, contract, surfaces),
        "computed_cascade_mismatch": computed_cascade_failures(root, surface_items(root, surfaces)),
        "computed_style_contract": computed_contract_failures(root, contract, surfaces),
        "style_distinctness": distinctness_failures(root, surfaces),
    }
    failures = {key: value for key, value in failures.items() if value}
    if failures:
        print("UXE contract failed")
        print(json.dumps(failures, indent=2))
        return 1
    print("UXE contract passed")
    return 0
