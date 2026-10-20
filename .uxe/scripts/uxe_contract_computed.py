"""Computed evidence helpers for UXE contract gates."""
import json
import re

from uxe_contract_css import binding_alias_conflicts, binding_aliases, read, surface_text

PROP_MAP = {"font-family": "fontFamily", "background": "backgroundColor", "background-color": "backgroundColor", "border-radius": "borderRadius", "box-shadow": "boxShadow", "border-color": "borderColor", "color": "color"}


def computed_path(root, surface):
    base, manifest = root / ".uxe" / "evidence", root / ".uxe" / "evidence" / "manifest.json"
    if manifest.exists():
        raw = json.loads(read(manifest))
        entries = raw.get("evidence", []) if isinstance(raw, dict) else raw if isinstance(raw, list) else []
        for entry in entries:
            if entry.get("surface") == surface and entry.get("kind") == "computed_style":
                path = root / entry.get("path", "")
                if path.exists():
                    return path
    for name in (f"{surface}.computed.json", f"{surface}.json"):
        path = base / name
        if path.exists():
            return path
    return None


def computed_data(root, surface):
    path = computed_path(root, surface)
    if not path:
        return None
    try:
        return json.loads(read(path))
    except json.JSONDecodeError:
        return None


def flatten_profile(profile):
    flat = {}
    for section in ("counts", "layout", "visual", "typography", "density"):
        for key, value in (profile.get(section) or {}).items():
            if value not in ("", None):
                flat[f"{section}.{key}"] = value
    return flat


def value_differs(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) > 1
    return str(a).strip().lower() != str(b).strip().lower()


def rendered_distance(a, b):
    aa, bb = flatten_profile(a), flatten_profile(b)
    keys = sorted(set(aa) & set(bb))
    if len(keys) < 4:
        return None
    weighted = {"visual.surface_radius", "visual.body_background", "typography.body_font_family", "typography.h1_font_weight"}
    return sum((2 if key in weighted else 1) for key in keys if value_differs(aa[key], bb[key]))


def terminal_font(data):
    family = ((data.get("rendered_style_profile") or {}).get("typography") or {}).get("body_font_family", "")
    for values in data.get("probes", {}).values():
        if values:
            family = family or values[0].get("styles", {}).get("fontFamily", "")
    return family.lower()


def numeric_px(value):
    match = re.match(r"^\s*(-?\d+(?:\.\d+)?)px\s*$", str(value or ""))
    return float(match.group(1)) if match else None


def color_tuple(value):
    value = str(value or "").strip().lower()
    if re.match(r"^#[0-9a-f]{6}$", value):
        return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5)) + (1,)
    nums = [float(n) for n in re.findall(r"[\d.]+", value)]
    if len(nums) >= 3:
        return tuple(int(round(n)) for n in nums[:3]) + (round(nums[3] if len(nums) > 3 else 1, 3),)
    return None


def computed_value_matches(prop, actual, expected):
    if str(actual or "").strip().lower() == str(expected or "").strip().lower():
        return True
    av, ev = numeric_px(actual), numeric_px(expected)
    if av is not None and ev is not None:
        return abs(av - ev) <= 0.51
    ac, ec = color_tuple(actual), color_tuple(expected)
    return bool(ac and ec and ac == ec)


def binding_key(binding, index):
    return binding.get("key") or f"binding:{binding.get('role') or 'binding'}:{index}"


def token_values(probe, root_vars, tokens):
    return [probe.get(token) or root_vars.get(token) for token in tokens]


def alias_matches(prop, actual, values, probe, aliases):
    if not aliases:
        return True
    for alias in aliases:
        value = probe.get(alias)
        token_match = any(computed_value_matches(prop, value, item) for item in values if item)
        if value and token_match and computed_value_matches(prop, actual, value):
            return True
    return False


def computed_binding_issue(data, binding, index, aliases=None, conflicts=None):
    if conflicts:
        return {"ambiguous_alias_definitions": conflicts}
    vars_data = data.get("computed_vars") or {}
    probe = (vars_data.get("probes") or {}).get(binding_key(binding, index))
    if not probe:
        return "missing_computed_binding_probe"
    root_vars, tokens = vars_data.get("root") or {}, binding.get("tokens") or []
    for prop in binding.get("properties") or []:
        actual = probe.get(PROP_MAP.get(prop, prop))
        values = token_values(probe, root_vars, tokens)
        token_match = any(computed_value_matches(prop, actual, value) for value in values if value)
        if actual and token_match and alias_matches(prop, actual, values, probe, aliases or []):
            return ""
    actuals = {PROP_MAP.get(p, p): probe.get(PROP_MAP.get(p, p)) for p in binding.get("properties") or []}
    return {"actual": actuals, "tokens": tokens, "aliases": aliases or []}


def computed_cascade_failures(root, surfaces):
    failures = []
    for surface in surfaces:
        data, bindings = computed_data(root, surface.get("id", "")), surface.get("token_bindings") or []
        if not data or not bindings:
            continue
        issues = []
        text = surface_text(root, surface, broad=False)
        for index, binding in enumerate(bindings):
            aliases = binding_aliases(text, binding)
            issue = computed_binding_issue(data, binding, index, aliases, binding_alias_conflicts(text, binding))
            if issue:
                issues.append({"role": binding.get("role", "binding"), "issue": issue})
        if issues:
            failures.append({"surface": surface.get("id", "project"), "bindings": issues})
    return failures
