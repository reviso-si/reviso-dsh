#!/usr/bin/env python3
"""Capture UXE screenshots and computed-style evidence."""
import argparse
import json
from pathlib import Path

from uxe_contract_css import binding_aliases, surface_text

DEFAULT_PROBES = [
    {"key": "h1", "selector": "h1", "required": "if_present_in_reference"},
    {"key": "paragraph", "selector": "p", "required": "always"},
    {"key": "list", "selector": "ul,ol", "required": "if_present_in_reference"},
    {"key": "code", "selector": "pre,code", "required": "if_present_in_reference"},
    {"key": "table", "selector": "table", "required": "if_present_in_reference"},
]
DEFAULT_PROPS = ["fontFamily", "fontSize", "lineHeight", "fontWeight", "color", "marginTop", "marginBottom", "backgroundColor", "borderRadius", "boxShadow", "borderColor"]
STYLE_REQUIRED = {
    "ant-design": ["--btn-primary-bg", "--input-bg", "--table-header-bg", "--tag-info-bg", "--card-bg"],
    "material-design": ["--btn-primary-bg", "--card-shadow", "--shape-radius-lg", "--material-state-layer-opacity-hover", "--background-page"],
    "terminal-cli": ["--typo-family", "--background-page", "--card-border", "--btn-primary-bg", "--table-border"],
    "liquid-glass-dark": ["--material-backdrop-blur", "--overlay-backdrop", "--card-bg", "--card-shadow", "--shape-radius-lg"],
    "liquid-glass-light": ["--material-backdrop-blur", "--overlay-backdrop", "--card-bg", "--card-shadow", "--shape-radius-lg"],
}
COMMON_TOKENS = ["--surface", "--elevated", "--text", "--text-muted", "--accent", "--border", "--font-body", "--font-mono", "--radius", "--background-page", "--card-bg", "--shape-radius-md", "--shape-radius-lg", "--typo-family"]
JS_COLLECT = """([rootSelector, probes, props, tokens]) => {
  const root = document.querySelector(rootSelector || 'body') || document.body;
  const text = el => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
  const styles = el => {
    const cs = getComputedStyle(el);
    const out = {};
    props.forEach(p => out[p] = cs[p]);
    return out;
  };
  const vars = el => {
    const cs = getComputedStyle(el);
    const out = {};
    tokens.forEach(t => out[t] = cs.getPropertyValue(t).trim());
    return out;
  };
  const visible = el => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  const count = sel => Array.from(root.querySelectorAll(sel)).filter(visible).length;
  const first = sel => Array.from(root.querySelectorAll(sel)).find(visible) || null;
  const firstOf = sel => sel.split(',').map(s => first(s.trim())).find(Boolean) || null;
  const box = el => {
    if (!el) return {};
    const r = el.getBoundingClientRect();
    return {width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top)};
  };
  const sampleStyle = sel => {
    const el = firstOf(sel) || root;
    const cs = getComputedStyle(el);
    return {surface_radius: cs.borderRadius, surface_shadow: cs.boxShadow, surface_border: cs.borderColor};
  };
  const result = {};
  const probeVars = {};
  probes.forEach(p => {
    const found = Array.from(root.querySelectorAll(p.selector)).slice(0, 3);
    result[p.key] = found.map(el => ({tag: el.tagName.toLowerCase(), text: text(el), styles: styles(el)}));
    if (found[0]) probeVars[p.key] = {...vars(found[0]), ...styles(found[0])};
  });
  const tags = Array.from(root.querySelectorAll('h1,h2,h3,p,ul,ol,li,blockquote,pre,code,table,th,td,a,img')).map(el => el.tagName.toLowerCase()).slice(0, 200);
  const main = first('main,[role=main],.app,.shell') || document.body;
  const bodyStyle = getComputedStyle(document.body);
  const h1Style = getComputedStyle(first('h1') || document.body);
  const button = first('button,.btn,[role=button]');
  const input = first('input,textarea,select');
  const visual = {body_background: bodyStyle.backgroundColor, ...sampleStyle('.card,.panel,.surface,section,main')};
  return {
    probes: result,
    computed_vars: {root: vars(document.documentElement), probes: probeVars},
    dom: {semantic_tags: tags},
    rendered_style_profile: {
      counts: {tables: count('table'), forms: count('form'), cards: count('.card,.panel,.tile,[data-card]'), buttons: count('button,.btn,[role=button]'), inputs: count('input,textarea,select')},
      layout: {body_width: Math.round(document.body.getBoundingClientRect().width), main_width: box(main).width, main_top: box(main).top},
      visual,
      typography: {body_font_family: bodyStyle.fontFamily, h1_font_weight: h1Style.fontWeight},
      density: {button_height: box(button).height || 0, input_height: box(input).height || 0}
    }
  };
}"""


def load_json(root, name):
    path = root / ".uxe" / name
    if not path.exists():
        raise SystemExit(f"UXE capture failed: missing {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def evidence_dir(root):
    path = root / ".uxe" / "evidence"
    path.mkdir(parents=True, exist_ok=True)
    return path


def surface_source(surface):
    for key in ("url", "entry", "artifact"):
        if surface.get(key):
            return key, surface[key]
    return "", ""


def surface_target(root, surface, base_url):
    key, raw = surface_source(surface)
    if raw.startswith(("http://", "https://", "file://")):
        return raw
    if key == "url" and raw and base_url:
        return base_url.rstrip("/") + "/" + raw.lstrip("/")
    if key in {"entry", "artifact"} and raw:
        path = (root / raw).resolve()
        if path.exists():
            return path.as_uri()
    return None


def probes_for(surfaces_data, surface_id):
    found = {item["key"]: item for item in DEFAULT_PROBES}
    surface = next((item for item in surfaces_data.get("surfaces", []) if item.get("id") == surface_id), {})
    for index, binding in enumerate(surface.get("token_bindings") or []):
        selectors = [item for item in binding.get("selectors", []) if item]
        if selectors:
            role = binding.get("role") or "binding"
            key = binding.get("key") or f"binding:{role}:{index}"
            found[key] = {"key": key, "selector": ",".join(selectors), "required": "always"}
    for group in surfaces_data.get("parity_groups", []):
        if surface_id not in group.get("surfaces", []):
            continue
        for item in group.get("probes", []):
            if item.get("key") and item.get("selector"):
                found[item["key"]] = item
    return list(found.values())


def tokens_for(root, surface):
    tokens = set(COMMON_TOKENS + STYLE_REQUIRED.get(surface.get("style_id", ""), []))
    tokens.update(surface.get("required_token_usage") or [])
    text = surface_text(root, surface, broad=False)
    for binding in surface.get("token_bindings") or []:
        tokens.update(binding.get("tokens") or [])
        tokens.update(binding_aliases(text, binding))
    return sorted(token for token in tokens if token.startswith("--"))


def js_collect():
    return JS_COLLECT


def explicit_selector(surface, key):
    selector = str(surface.get(key) or "").strip()
    return selector if selector and selector != "body" else ""


def selector_failure(page, surface):
    for key in ("root_selector", "screenshot_selector"):
        selector = explicit_selector(surface, key)
        if selector and not page.query_selector(selector):
            return f"missing_{key}:{surface['id']}:{selector}"
    return ""


def screenshot(page, surface, png):
    selector = surface.get("screenshot_selector") or surface.get("root_selector")
    if selector:
        element = page.query_selector(selector)
        if element:
            element.screenshot(path=str(png))
            return
    page.screenshot(path=str(png), full_page=True)


def capture_surface(page, root, surfaces_data, surface, base_url):
    target = surface_target(root, surface, base_url)
    if not target:
        return None, f"missing_target:{surface['id']}"
    theme = surface.get("theme")
    if theme in {"light", "dark"}:
        page.emulate_media(color_scheme=theme)
    page.goto(target, wait_until=surface.get("wait_until", "networkidle"))
    if surface.get("wait_for"):
        page.wait_for_selector(surface["wait_for"], timeout=10000)
    failure = selector_failure(page, surface)
    if failure:
        return None, failure
    out = evidence_dir(root)
    surface_id = surface["id"]
    png = out / f"{surface_id}.png"
    computed = out / f"{surface_id}.computed.json"
    screenshot(page, surface, png)
    data = page.evaluate(js_collect(), [surface.get("root_selector", "body"), probes_for(surfaces_data, surface_id), DEFAULT_PROPS, tokens_for(root, surface)])
    source, _ = surface_source(surface)
    data.update({"surface": surface_id, "url": target, "source": source})
    computed.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return [
        {"surface": surface_id, "kind": "screenshot", "path": str(png.relative_to(root))},
        {"surface": surface_id, "kind": "computed_style", "path": str(computed.relative_to(root))},
    ], None


def write_manifest(root, entries):
    path = evidence_dir(root) / "manifest.json"
    path.write_text(json.dumps({"evidence": entries}, indent=2) + "\n", encoding="utf-8")


def new_page(browser, surface, args):
    viewport = surface.get("viewport") or {"width": 1440, "height": 900}
    options = {"viewport": viewport}
    auth_state = surface.get("auth_state") or args.auth_state
    if auth_state:
        options["storage_state"] = str(Path(auth_state).expanduser())
    locale = surface.get("locale") or args.locale
    if locale:
        options["locale"] = locale
    return browser.new_context(**options).new_page()


def main():
    parser = argparse.ArgumentParser(description="Capture UXE visual evidence with Playwright.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--base-url", default="")
    parser.add_argument("--auth-state", default="")
    parser.add_argument("--locale", default="")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    surfaces_data = load_json(root, "surfaces.json")
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise SystemExit("UXE capture failed: playwright is not installed") from exc
    entries, failures = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for surface in surfaces_data.get("surfaces", []):
            page = new_page(browser, surface, args)
            captured, failure = capture_surface(page, root, surfaces_data, surface, args.base_url)
            entries.extend(captured or [])
            failures.extend([failure] if failure else [])
            page.context.close()
        browser.close()
    write_manifest(root, entries)
    if failures:
        print("UXE capture failed")
        print(json.dumps({"failures": failures}, indent=2))
        return 1
    print("UXE capture passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
