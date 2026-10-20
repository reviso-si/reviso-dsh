#!/usr/bin/env python3
"""Project-local UXE React component safety gate."""
import argparse
import html
import json
import re
from pathlib import Path

IGNORED = {".git", ".next", ".uxe", "build", "coverage", "dist", "node_modules", "playwright-report", "test-results"}
SUFFIXES = {".tsx", ".jsx"}
TEST_FILE = re.compile(r"\.(?:test|spec|stories|story)\.[tj]sx$", re.I)
ATTR = re.compile(r"([:@\w-]+)(?:\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|{([^}]*)}|([^\s\"'=<>`]+)))?")
HEX_STYLE = re.compile(r"style=\{\{[^}]*#[0-9a-fA-F]{3,8}\b", re.S)
TYPE_STYLE = re.compile(r"style=\{\{[^}]*(?:fontSize|lineHeight|fontWeight)\s*:", re.S)


def project_files(root):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUFFIXES:
            continue
        if any(part in IGNORED for part in path.parts):
            continue
        if TEST_FILE.search(path.name) or "__tests__" in path.parts:
            continue
        yield path


def parse_attrs(src):
    parsed = {}
    for match in ATTR.finditer(src):
        val = next((g for g in match.groups()[1:] if g is not None), "")
        parsed[match.group(1).lower()] = html.unescape(val)
    return parsed


def tag_end(raw, start):
    quote, braces = "", 0
    for i in range(start, len(raw)):
        ch = raw[i]
        if quote:
            quote = "" if ch == quote and raw[i - 1] != "\\" else quote
        elif ch in {'"', "'", "`"}:
            quote = ch
        elif ch == "{":
            braces += 1
        elif ch == "}":
            braces = max(0, braces - 1)
        elif ch == ">" and braces == 0:
            return i + 1
    return -1


def scan_tags(raw, wanted=None):
    tags, i = [], 0
    while i < len(raw):
        start = raw.find("<", i)
        if start < 0:
            break
        if start + 1 >= len(raw) or not raw[start + 1].isalpha() or raw[start + 1].isupper():
            i = start + 1
            continue
        end_name = re.match(r"<([a-z][\w:-]*)\b", raw[start:], re.I)
        if not end_name:
            i = start + 1
            continue
        tag = end_name.group(1).lower()
        end = tag_end(raw, start)
        if end < 0:
            break
        if wanted is None or tag in wanted:
            attr_src = raw[start + len(tag) + 1:end - 1].rstrip("/").strip()
            tags.append({"tag": tag, "attrs": parse_attrs(attr_src), "start": start, "end": end, "full": raw[start:end]})
        i = end
    return tags


def body_for(raw, item):
    close = re.search(rf"</{re.escape(item['tag'])}\s*>", raw[item["end"]:], re.I)
    if not close:
        return ""
    return raw[item["end"]:item["end"] + close.start()]


def tag_ranges(raw, tag):
    ranges = []
    for item in scan_tags(raw, {tag}):
        body = body_for(raw, item)
        if body:
            ranges.append((item["start"], item["end"] + len(body), body))
    return ranges


def contains(ranges, pos):
    return any(start <= pos <= end for start, end, _ in ranges)


def visible_text(src):
    text = re.sub(r"<[^>]+>", " ", src)
    text = re.sub(r"{[^}]+}", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def add(issues, path, issue_id, detail, evidence=""):
    issues.append({"id": issue_id, "path": str(path), "detail": detail, "evidence": re.sub(r"\s+", " ", evidence).strip()[:220]})


def has_accessible_name(attr, body=""):
    if attr.get("aria-label") or attr.get("aria-labelledby") or attr.get("title"):
        return True
    if visible_text(body):
        return True
    return bool(re.search(r"{\s*(?:children|label|title|name)\s*}", body))


def check_anchors(path, raw, issues):
    for item in scan_tags(raw, {"a"}):
        attr, full = item["attrs"], item["full"]
        href = attr.get("href", "")
        if href in {"#", "javascript:void(0)", "javascript:void(0);"}:
            add(issues, path, "COMPONENT_DEAD_ANCHOR", "Anchor has no meaningful href.", full)
        elif not href and "onclick" in attr:
            add(issues, path, "COMPONENT_ANCHOR_BUTTON", "Clickable anchor has no href; use button or provide navigation.", full)


def check_buttons(path, raw, issues):
    forms = tag_ranges(raw, "form")
    for item in scan_tags(raw, {"button"}):
        attr, full = item["attrs"], item["full"]
        body = body_for(raw, item)
        if contains(forms, item["start"]) and "type" not in attr:
            add(issues, path, "COMPONENT_BUTTON_MISSING_TYPE", "Button in a component with a form needs explicit type.", full)
        iconish = re.search(r"<(?:svg|[A-Z][A-Za-z0-9]*Icon)\b|icon-", body)
        if iconish and not has_accessible_name(attr, body):
            add(issues, path, "COMPONENT_ICON_BUTTON_NAME", "Icon-only button has no accessible name.", full)
        if attr.get("aria-busy") == "true" and "disabled" not in attr:
            add(issues, path, "COMPONENT_BUSY_NOT_DISABLED", "Busy button/control is not disabled.", full)


def check_inputs(path, raw, issues):
    labels = tag_ranges(raw, "label")
    for item in scan_tags(raw, {"input"}):
        attr, full = item["attrs"], item["full"]
        if attr.get("type", "").lower() == "hidden":
            continue
        named = attr.get("aria-label") or attr.get("aria-labelledby") or attr.get("id") or contains(labels, item["start"])
        if not named:
            add(issues, path, "COMPONENT_INPUT_UNLABELED", "Input has no id or ARIA label hook.", full)
        if attr.get("placeholder") and not named:
            add(issues, path, "COMPONENT_PLACEHOLDER_LABEL", "Placeholder is being used without a label hook.", full)


def check_images(path, raw, issues):
    for item in scan_tags(raw, {"img"}):
        attr, full = item["attrs"], item["full"]
        if "alt" not in attr:
            add(issues, path, "COMPONENT_IMAGE_MISSING_ALT", "Image is missing alt text.", full)


def check_clickable_noninteractive(path, raw, issues):
    for tag in ("div", "span"):
        for item in scan_tags(raw, {tag}):
            attr, full = item["attrs"], item["full"]
            if "onclick" not in attr:
                continue
            if attr.get("role") or "tabindex" in attr:
                continue
            add(issues, path, "COMPONENT_CLICKABLE_NONINTERACTIVE", f"Clickable {tag} lacks role and tabIndex.", full)


def check_roles(path, raw, issues):
    for item in scan_tags(raw, {"div", "section"}):
        attr, full = item["attrs"], item["full"]
        role = attr.get("role", "").lower()
        if role == "dialog" and not (attr.get("aria-label") or attr.get("aria-labelledby")):
            add(issues, path, "COMPONENT_DIALOG_UNLABELED", "Dialog role needs aria-label or aria-labelledby.", full)
        if role == "tab" and "aria-selected" not in attr:
            add(issues, path, "COMPONENT_TAB_MISSING_SELECTED", "Tab role needs aria-selected.", full)


def check_inline_style(path, raw, issues):
    if HEX_STYLE.search(raw):
        add(issues, path, "COMPONENT_INLINE_HEX_STYLE", "Inline style contains raw hex color.")
    if TYPE_STYLE.search(raw):
        add(issues, path, "COMPONENT_INLINE_TYPE_STYLE", "Inline style contains typography value; use tokens/classes.")


def audit_file(root, path):
    raw = path.read_text(encoding="utf-8", errors="ignore")
    rel = path.relative_to(root)
    issues = []
    for check in (check_anchors, check_buttons, check_inputs, check_images, check_clickable_noninteractive, check_roles, check_inline_style):
        check(rel, raw, issues)
    return issues


def main():
    parser = argparse.ArgumentParser(description="Run UXE component-safe static checks.")
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    issues = []
    for path in project_files(root):
        issues.extend(audit_file(root, path))
    if issues:
        print("UXE component failed")
        print(json.dumps({"issues": issues[:100]}, indent=2))
        return 1
    print("UXE component passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
