#!/usr/bin/env python3
"""Project-local UXE taste and AI-tell gate."""
import argparse
import html
import json
import re
from pathlib import Path
from uxe_ai_detector_bridge import ai_detector_issues

IGNORED = {".git", ".next", ".uxe", "build", "coverage", "dist", "node_modules", "playwright-report", "test-results"}
SUFFIXES = {".html", ".tsx", ".jsx"}
DOC_DIRS = {"docs", "documentation"}
PAGE_NAMES = {"page.tsx", "page.jsx", "index.tsx", "index.jsx", "home.tsx", "landing.tsx"}
GOOGLE_FONT = re.compile(r"<link\b[^>]+(?:fonts\.googleapis\.com|fonts\.gstatic\.com)", re.I)
THREE_COL = re.compile(r"grid-template-columns\s*:\s*(?:repeat\(\s*3\s*,\s*1fr\s*\)|1fr\s+1fr\s+1fr)", re.I)
CARD_CLASS = re.compile(r"class(?:Name)?=['\"][^'\"]*(?:card|feature|tile|panel)[^'\"]*['\"]", re.I)
GRID_CLASS = re.compile(r"class(?:Name)?=['\"][^'\"]*(?:features|cards|platform|benefits|capabilities|grid)[^'\"]*['\"]", re.I)
SUCCESS = re.compile(r"(?:class(?:Name)?=['\"][^'\"]*(?:success|is-success|state-success|valid)[^'\"]*['\"]|role=['\"]status['\"])", re.I)
ERROR = re.compile(r"(?:class(?:Name)?=['\"][^'\"]*(?:error|is-error|state-error|invalid|danger)[^'\"]*['\"]|role=['\"]alert['\"]|aria-invalid=['\"]true)", re.I)
PRECISION = re.compile(r"\b(?:\d+\.\d+\s*(?:%|x|ms|s|m|h|mm|lb|kg)|\d{2,3}\s*%|\d{2,4}\s*ms|\$[1-9]\d{1,2},\d{3})\b", re.I)
SOURCE = re.compile(r"\b(?:source|measured|actual|real data|sample|example|mock|synthetic|fixture|estimate)\b", re.I)
OFFICIAL_LOGO = re.compile(r"simpleicons|simple-icons|cdn\.simpleicons|devicon|<img\b|<image\b|<use\b", re.I)
POETIC = re.compile(r"\b(?:field notes|from the bench|loose plates|on our desks|currently on the bench)\b", re.I)
PLACEHOLDER_NAME = re.compile(r"\b(?:john doe|jane doe|sarah chan|alice chen|jack su|acme co|nexus|smartflow|cloudly)\b", re.I)
META_COPY = re.compile(r"\b(?:ant design components|style contract|design-system flavored|product adjectives rejected|built with tokens|clear states and enterprise density)\b", re.I)
EM_DASH = re.compile("[\u2013\u2014]")
CTA_INTENTS = {
    "contact": re.compile(r"\b(?:get in touch|contact us|let'?s talk|request demo|book demo|schedule demo)\b", re.I),
    "signup": re.compile(r"\b(?:get started|try free|sign up|start free|create account)\b", re.I),
    "buy": re.compile(r"\b(?:buy now|order now|reserve|checkout|purchase)\b", re.I),
}


def surface_entries(root):
    path = root / ".uxe" / "surfaces.json"
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = set()
    for surface in data.get("surfaces", []):
        for key in ("entry", "path", "file"):
            if surface.get(key):
                entries.add((root / surface[key]).resolve())
    return entries


def is_page_entry(root, path, entries):
    if path.resolve() in entries:
        return True
    parts = path.relative_to(root).parts
    if path.suffix.lower() == ".html" and any(part in DOC_DIRS for part in parts[:-1]):
        return False
    if path.suffix.lower() not in {".tsx", ".jsx"}:
        return True
    if path.name.lower() in PAGE_NAMES:
        return True
    return "pages" in path.parts


def project_files(root, entries):
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SUFFIXES:
            continue
        if any(part in IGNORED for part in path.parts):
            continue
        if not is_page_entry(root, path, entries):
            continue
        yield path


def read_text(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def visible_text(raw):
    text = re.sub(r"<(script|style)\b.*?</\1>", " ", raw, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def add(issues, path, issue_id, detail, evidence=""):
    issues.append({"id": issue_id, "path": str(path), "detail": detail, "evidence": re.sub(r"\s+", " ", evidence).strip()[:240]})


def sections(raw):
    found = re.findall(r"<section\b[^>]*>.*?</section>", raw, re.I | re.S)
    return found or [raw]


def hero(raw):
    for pattern in (
        r"<section\b(?=[^>]*(?:class=['\"][^'\"]*hero|data-section=['\"]hero))[^>]*>.*?</section>",
        r"<main\b[^>]*>.*?</main>",
    ):
        match = re.search(pattern, raw, re.I | re.S)
        if match:
            return match.group(0)
    return ""


def attr_values(raw, tag, attr):
    pattern = re.compile(rf"<{tag}\b[^>]*\b{attr}=(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))", re.I)
    return [html.unescape(next(g for g in m.groups() if g is not None)) for m in pattern.finditer(raw)]


def control_labels(raw):
    labels = []
    for tag in ("a", "button"):
        for body in re.findall(rf"<{tag}\b[^>]*>(.*?)</{tag}>", raw, re.I | re.S):
            label = visible_text(body)
            if label:
                labels.append(label)
    return labels


def check_browser_identity(path, raw, mode, issues):
    if path.suffix != ".html" or "<head" not in raw.lower():
        return
    if not re.search(r"<title>\s*[^<]+", raw, re.I):
        add(issues, path, "TASTE_MISSING_TITLE", "HTML document has no non-empty title.")
    if not re.search(r"<meta\b[^>]+name=['\"]description['\"][^>]+content=['\"][^'\"]+", raw, re.I):
        add(issues, path, "TASTE_MISSING_META_DESCRIPTION", "HTML document has no meta description.")
    if not re.search(r"<meta\b[^>]+name=['\"]theme-color['\"][^>]+content=['\"][^'\"]+", raw, re.I):
        add(issues, path, "TASTE_MISSING_THEME_COLOR", "HTML document has no theme-color.")
    icons = []
    for tag in re.findall(r"<link\b[^>]*>", raw, re.I):
        if re.search(r"\brel=['\"][^'\"]*icon", tag, re.I):
            icons.extend(attr_values(tag, "link", "href"))
    if not icons or any(not icon or icon == "#" or "emoji" in icon.lower() for icon in icons):
        add(issues, path, "TASTE_MISSING_FAVICON", "HTML document has no usable non-emoji favicon.")
    if mode == "marketing-landing" and "<main" in raw.lower() and "<footer" not in raw.lower():
        add(issues, path, "TASTE_MISSING_FOOTER", "Marketing page has main content but no footer element.")


def check_links_and_forms(path, raw, issues):
    ids = set(re.findall(r"\bid=['\"]([^'\"]+)['\"]", raw, re.I))
    for href in attr_values(raw, "a", "href"):
        if href == "#" or (href.startswith("#") and href[1:] not in ids):
            add(issues, path, "TASTE_DEAD_LINK", "Anchor has no meaningful target.", href)
            break
    if path.suffix == ".html":
        for action in attr_values(raw, "form", "action"):
            if action.startswith("/") and not re.search(r"\bmethod=['\"](?:post|get)['\"]", raw, re.I):
                add(issues, path, "TASTE_DEAD_FORM_ACTION", "Static HTML form points at an unproven local endpoint.", action)
                break
    if re.search(r"<a\b[^>]+href=['\"]#(?:contact|access|form|request)['\"][^>]*>\s*(?:export|assign|review|download|save)", raw, re.I):
        add(issues, path, "TASTE_ACTION_LINK_MISMATCH", "Action link points to a generic form section instead of the action target.")


def check_layout_and_hero(path, raw, issues):
    if THREE_COL.search(raw):
        for section in sections(raw):
            if GRID_CLASS.search(section) and len(CARD_CLASS.findall(section)) >= 3:
                add(issues, path, "TASTE_THREE_EQUAL_CARDS", "Three equal feature cards use a banned default layout.", section[:500])
                break
    h = hero(raw)
    if not h:
        return
    if len(re.findall(r"<(?:a|button)\b", h, re.I)) > 2:
        add(issues, path, "TASTE_HERO_CTA_OVERLOAD", "Hero contains more than two CTA-like controls.", h[:500])
    if re.search(r"(?:status|metric|stat)-grid|class(?:Name)?=['\"][^'\"]*(?:status|metric|stat)-card", h, re.I):
        add(issues, path, "TASTE_HERO_STACK_OVERFLOW", "Hero includes status or metric cards instead of a single focused value prop.", h[:500])
    if re.search(r"h1[^{]{0,120}\{[^}]*max-width\s*:\s*(?:[0-9.]+)?1[0-2]ch", raw, re.I):
        add(issues, path, "TASTE_FRAGMENTED_HEADLINE", "Hero headline max-width is narrow enough to fragment into too many lines.")


def check_states_and_forms(path, raw, issues):
    for block in re.findall(r"<form\b[^>]*>.*?</form>", raw, re.I | re.S) + sections(raw):
        low = block.lower()
        if SUCCESS.search(block) and ERROR.search(block) and "hidden" not in low and "aria-hidden" not in low:
            add(issues, path, "TASTE_STATE_STACKING", "Success and error states are visible at the same time.", block[:500])
            break
    checkbox_label = re.compile(r"<(md-checkbox|input\b[^>]+type=['\"]checkbox)[^>]*>\s*<label\b([^>]*)>", re.I | re.S)
    for match in checkbox_label.finditer(raw):
        checkbox_tag = match.group(0).split(">")[0]
        if "id=" not in checkbox_tag.lower() or "for=" not in match.group(2).lower():
            add(issues, path, "TASTE_UNBOUND_CHECKBOX_LABEL", "Checkbox and adjacent label are not bound by id/for.")
            break


def check_visual_assets(path, raw, issues):
    h = hero(raw)
    if h and re.search(r"class(?:Name)?=['\"][^'\"]*(?:product-(?:media|illustration)|mockup|screenshot|workspace)[^'\"]*['\"][^>]*>.*?<svg\b", h, re.I | re.S):
        add(issues, path, "TASTE_FAKE_PRODUCT_VISUAL", "Primary visual is inline SVG or div-built fake product media.", h[:500])
    for section in sections(raw):
        if re.search(r"class(?:Name)?=['\"][^'\"]*(?:logos|logo-wall|trust)[^'\"]*", section, re.I):
            svgs = re.findall(r"<svg\b.*?</svg>", section, re.I | re.S)
            simple = [s for s in svgs if not OFFICIAL_LOGO.search(s) and re.search(r"<(?:rect|circle|ellipse|polygon|line)\b", s, re.I)]
            if len(simple) >= 3 or (not re.search(r"<(?:img|svg|use)\b", section, re.I)):
                add(issues, path, "TASTE_FAKE_LOGO_WALL", "Logo wall uses fake marks or text-only logos.", section[:500])
                break


def check_copy(path, raw, text, issues):
    for regex, issue_id, detail in (
        (EM_DASH, "TASTE_EM_DASH", "Visible copy contains an em dash or en dash."),
        (POETIC, "TASTE_POETIC_LABEL", "Section label uses performative poetic wording."),
        (PLACEHOLDER_NAME, "TASTE_PLACEHOLDER_NAME", "Visible copy contains placeholder names or startup-slop brands."),
        (META_COPY, "TASTE_META_COMMENTARY", "Visible copy describes implementation/style instead of product value."),
    ):
        match = regex.search(text)
        if match:
            add(issues, path, issue_id, detail, match.group(0))
    for match in PRECISION.finditer(text):
        context = text[max(0, match.start() - 90):min(len(text), match.end() + 90)]
        if not SOURCE.search(context):
            add(issues, path, "TASTE_FAKE_PRECISION", "Precise metric appears without visible source or mock-data labeling.", context)
            break


def check_ctas(path, raw, issues):
    grouped = {}
    for label in control_labels(raw):
        for intent, pattern in CTA_INTENTS.items():
            if pattern.search(label):
                grouped.setdefault(intent, []).append(label)
    for intent, labels in grouped.items():
        if len(labels) > 1:
            add(issues, path, "TASTE_DUPLICATE_CTA_INTENT", f"Duplicate CTA intent `{intent}` appears {len(labels)} times.", ", ".join(labels[:5]))


def check_components(path, raw, issues):
    if re.search(r"class(?:Name)?=['\"][^'\"]*\bdot\b[^'\"]*['\"][^>]*", raw, re.I) and not re.search(r"\b(?:online|offline|live|error|success|warning|available)\b", raw, re.I):
        add(issues, path, "TASTE_DECORATIVE_DOT", "Decorative dot appears without semantic status meaning.")
    for body in re.findall(r"class(?:Name)?=['\"][^'\"]*(?:statistic-content|metric-value)[^'\"]*['\"][^>]*>(.*?)</", raw, re.I | re.S):
        label = visible_text(body)
        if label and not re.search(r"\d", label):
            add(issues, path, "TASTE_METRIC_SEMANTIC_MISMATCH", "Metric/statistic visual treatment is used for non-numeric content.", label)
            break


def load_mode(root):
    path = root / ".uxe" / "contract.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")).get("product_mode", "mixed-product")
    return "mixed-product"


def audit_file(root, path, mode):
    raw = read_text(path)
    text = visible_text(raw)
    issues = []
    for check in (check_links_and_forms, check_layout_and_hero, check_states_and_forms, check_visual_assets, check_components):
        check(path.relative_to(root), raw, issues)
    check_browser_identity(path.relative_to(root), raw, mode, issues)
    check_copy(path.relative_to(root), raw, text, issues)
    check_ctas(path.relative_to(root), raw, issues)
    if GOOGLE_FONT.search(raw):
        add(issues, path.relative_to(root), "TASTE_GOOGLE_FONT_LINK", "Google Fonts are loaded through external link tags.")
    return issues


def main():
    parser = argparse.ArgumentParser(description="Run UXE deterministic taste checks.")
    parser.add_argument("--project-root", default=".")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    mode = load_mode(root)
    entries = surface_entries(root)
    issues = []
    paths = list(project_files(root, entries))
    for path in paths:
        issues.extend(audit_file(root, path, mode))
    issues.extend(ai_detector_issues(root, [p for p in paths if p.suffix.lower() == ".html"]))
    if issues:
        print("UXE taste failed")
        print(json.dumps({"issues": issues[:100]}, indent=2))
        return 1
    print("UXE taste passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
