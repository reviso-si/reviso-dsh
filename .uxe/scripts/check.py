#!/usr/bin/env python3
"""Project-local UXE static drift gate."""
import argparse
import json
import re
from pathlib import Path

IGNORED = {".git", ".next", ".uxe", "build", "coverage", "dist", "node_modules", "playwright-report", "test-results"}
SUFFIXES = {".css", ".scss", ".tsx", ".ts", ".jsx", ".js", ".html"}
VAR_DEF = re.compile(r"(--[A-Za-z0-9_-]+)\s*:\s*([^;}{]+)")
VAR_USE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
HEX = re.compile(r"(?<![\w-])#[0-9a-fA-F]{3,8}\b")
TYPE_PROP = re.compile(r"\b(font-size|line-height|font-weight)\s*:\s*(?!var\()([^;}{]+)")


def project_files(root):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in SUFFIXES:
            continue
        if any(part in IGNORED for part in path.parts):
            continue
        yield path


def read_text(path):
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def load_json(root, name):
    path = root / ".uxe" / name
    if not path.exists():
        raise SystemExit(f"UXE check failed: missing {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def collect_sources(root):
    files = list(project_files(root))
    chunks = [(path, read_text(path)) for path in files]
    return chunks, "\n".join(text for _, text in chunks)


def collect_var_defs(chunks):
    values = {}
    for path, text in chunks:
        for token, value in VAR_DEF.findall(text):
            values.setdefault(token, []).append((path, value.strip()))
    return values


def required_color_tokens(token_map):
    tokens = []
    for item in token_map.get("required_maps", {}).get("color", []):
        css_var = item.get("css_var")
        if item.get("status") == "missing" or not css_var:
            tokens.append((item.get("canonical"), None))
        else:
            tokens.append((item.get("canonical"), css_var))
    return tokens


def missing_tokens(token_map, var_defs):
    missing = []
    for canonical, css_var in required_color_tokens(token_map):
        if not css_var or css_var not in var_defs:
            missing.append(canonical or css_var)
    return missing


def undefined_vars(chunks, var_defs):
    issues = []
    defined = set(var_defs)
    for path, text in chunks:
        for token in VAR_USE.findall(text):
            if token not in defined:
                issues.append(f"{path}:{token}")
    return issues[:50]


def hardcoded_hex(chunks):
    issues = []
    for path, text in chunks:
        for line_no, line in enumerate(text.splitlines(), 1):
            searchable = re.sub(r"--[A-Za-z0-9_-]+\s*:\s*[^;}{]+;?", "", line)
            hits = HEX.findall(searchable)
            if hits:
                issues.append(f"{path}:{line_no}:{','.join(hits)}")
    return issues[:50]


def hardcoded_type(chunks):
    issues = []
    for path, text in chunks:
        for line_no, line in enumerate(text.splitlines(), 1):
            searchable = re.sub(r"--[A-Za-z0-9_-]+\s*:\s*[^;}{]+;?", "", line)
            for prop, value in TYPE_PROP.findall(searchable):
                value = value.strip()
                if value in {"inherit", "normal"}:
                    continue
                issues.append(f"{path}:{line_no}:{prop}:{value}")
    return issues[:50]


def parse_hex(value):
    match = HEX.search(value)
    if not match:
        return None
    raw = match.group(0).lstrip("#")
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) not in {6, 8}:
        return None
    return tuple(int(raw[i:i + 2], 16) for i in (0, 2, 4))


def luminance(rgb):
    vals = []
    for channel in rgb:
        c = channel / 255
        vals.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * vals[0] + 0.7152 * vals[1] + 0.0722 * vals[2]


def contrast_ratio(a, b):
    la = luminance(a)
    lb = luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def token_color(var_defs, token):
    values = var_defs.get(token) or []
    for _, value in values:
        color = parse_hex(value)
        if color:
            return color
    return None


def contrast_issues(token_map, var_defs):
    aliases = token_map.get("alias_map", {})
    pairs = [("text", "surface", 4.5), ("text-muted", "surface", 3.0), ("focus-ring", "surface", 3.0)]
    issues = []
    for fg, bg, threshold in pairs:
        fg_token = aliases.get(fg)
        bg_token = aliases.get(bg)
        if not fg_token or not bg_token:
            continue
        fg_color = token_color(var_defs, fg_token)
        bg_color = token_color(var_defs, bg_token)
        if not fg_color or not bg_color:
            continue
        ratio = contrast_ratio(fg_color, bg_color)
        if ratio < threshold:
            issues.append(f"{fg_token} on {bg_token}: {ratio:.2f} < {threshold}")
    return issues


def dark_defs(text):
    if not re.search(r"prefers-color-scheme\s*:\s*dark|\[data-theme=['\"]?dark", text):
        return None
    zones = []
    for marker in re.finditer(r"prefers-color-scheme\s*:\s*dark|\[data-theme=['\"]?dark", text):
        zones.append(text[marker.start():marker.start() + 6000])
    return {token for zone in zones for token, _ in VAR_DEF.findall(zone)}


def dark_mode_issues(token_map, text):
    dark = dark_defs(text)
    if dark is None:
        return ["missing_dark_mode"]
    required = {css_var for _, css_var in required_color_tokens(token_map) if css_var}
    missing = sorted(required - dark)
    return [f"dark_missing:{token}" for token in missing[:30]]


def main():
    parser = argparse.ArgumentParser(description="Run UXE token, contrast, and drift checks.")
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    token_map = load_json(root, "token-map.json")
    chunks, text = collect_sources(root)
    var_defs = collect_var_defs(chunks)
    failures = {
        "missing_tokens": missing_tokens(token_map, var_defs),
        "undefined_css_vars": undefined_vars(chunks, var_defs),
        "raw_hex_outside_tokens": hardcoded_hex(chunks),
        "hardcoded_typography": hardcoded_type(chunks),
        "contrast": contrast_issues(token_map, var_defs),
        "dark_light_asymmetry": dark_mode_issues(token_map, text),
    }
    failures = {key: value for key, value in failures.items() if value}
    if failures:
        print("UXE check failed")
        print(json.dumps(failures, indent=2))
        return 1
    print("UXE check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
