"""Small CSS/source scanner helpers for UXE contract gates."""
import re

IGNORED = {".advisor", ".git", ".next", ".uxe", "build", "coverage", "dist", "node_modules"}
SOURCE_SUFFIXES = {".css", ".scss", ".html", ".tsx", ".jsx"}
VAR_USE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)")
VAR_DEF = re.compile(r"(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)\s*(?=[;}])")
CSS_RULE = re.compile(r"([^{}]+)\{([^{}]*)\}", re.S)
CSS_DECL = re.compile(r"([-\w]+)\s*:\s*([^;{}]+)")
LINK_TAG = re.compile(r"<link\b[^>]*>", re.I)
HREF = re.compile(r"href=[\"']([^\"']+)[\"']", re.I)


def read(path):
    return path.read_text(encoding="utf-8", errors="ignore")


def project_files(root):
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in SOURCE_SUFFIXES:
            if not any(part in IGNORED for part in path.relative_to(root).parts):
                yield path


def all_source_text(root):
    return "\n".join(read(path) for path in project_files(root))


def surface_path(root, surface):
    for key in ("entry", "artifact", "path", "file"):
        raw = surface.get(key)
        if raw:
            path = (root / raw).resolve()
            return path if path.exists() else None
    return None


def linked_css(root, html_path, html):
    texts = []
    for tag in LINK_TAG.findall(html):
        if "stylesheet" not in tag.lower():
            continue
        match = HREF.search(tag)
        if not match or match.group(1).startswith(("http://", "https://", "data:", "#")):
            continue
        path = (html_path.parent / match.group(1).split("#", 1)[0].split("?", 1)[0]).resolve()
        if path.exists() and path.is_relative_to(root):
            texts.append(read(path))
    return texts


def surface_text(root, surface, broad=True):
    path = surface_path(root, surface)
    if path:
        text = read(path)
        if path.suffix.lower() == ".html":
            return "\n".join([text, *linked_css(root, path, text)])
        return text
    return all_source_text(root) if broad else ""


def css_rules(text):
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    for raw_selectors, raw_decls in CSS_RULE.findall(text):
        selectors = [item.strip() for item in raw_selectors.split(",") if item.strip()]
        decls = [(prop.strip().lower(), value.strip()) for prop, value in CSS_DECL.findall(raw_decls)]
        if selectors and decls:
            yield selectors, decls


def selector_matches(actual, target):
    actual, target = re.sub(r"\s+", " ", actual.strip()), target.strip()
    if actual == target:
        return True
    boundary = r"($|[\s>+~:.#\[])"
    return re.search(rf"(^|[\s>+~]){re.escape(target)}{boundary}", actual) is not None


def var_definitions(text):
    found = {}
    for token, value in VAR_DEF.findall(text):
        found.setdefault(token, []).append(value.strip())
    return found


def value_reaches_token(value, targets, definitions, seen=None):
    seen = seen or set()
    for token in VAR_USE.findall(value):
        if token in targets:
            return True
        if token in seen:
            continue
        seen.add(token)
        if any(value_reaches_token(item, targets, definitions, seen) for item in definitions.get(token, [])):
            return True
    return False


def value_aliases(value, targets, definitions):
    vars_used = VAR_USE.findall(value)
    if any(token in targets for token in vars_used):
        return []
    return [token for token in vars_used if any(value_reaches_token(item, targets, definitions) for item in definitions.get(token, []))]


def matched_binding_values(text, binding):
    selectors = [item for item in binding.get("selectors", []) if item]
    props = {item.lower() for item in binding.get("properties", []) if item}
    for rule_selectors, decls in css_rules(text):
        hit = any(selector_matches(rule, target) for rule in rule_selectors for target in selectors)
        if hit:
            yield from (value for prop, value in decls if prop in props)


def binding_aliases(text, binding):
    tokens = {item for item in binding.get("tokens", []) if item.startswith("--")}
    if not tokens:
        return []
    definitions, found = var_definitions(text), []
    for value in matched_binding_values(text, binding):
        found.extend(value_aliases(value, tokens, definitions))
    return sorted(set(found))


def binding_alias_conflicts(text, binding):
    tokens = {item for item in binding.get("tokens", []) if item.startswith("--")}
    definitions = var_definitions(text)
    conflicts = []
    for alias in binding_aliases(text, binding):
        if any(not value_reaches_token(value, tokens, definitions) for value in definitions.get(alias, [])):
            conflicts.append(alias)
    return conflicts


def binding_satisfied(text, binding):
    selectors = [item for item in binding.get("selectors", []) if item]
    props = {item.lower() for item in binding.get("properties", []) if item}
    tokens = {item for item in binding.get("tokens", []) if item.startswith("--")}
    if not selectors or not props or not tokens:
        return True
    definitions = var_definitions(text)
    for value in matched_binding_values(text, binding):
        if value_reaches_token(value, tokens, definitions):
            return True
    return False
