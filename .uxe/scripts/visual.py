#!/usr/bin/env python3
"""Project-local UXE visual evidence gate."""
import argparse
import json
import re
from pathlib import Path

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
DEFAULT_PROBES = [{"key": "h1", "required": "if_present_in_reference"}, {"key": "paragraph", "required": "always"}, {"key": "list", "required": "if_present_in_reference"}, {"key": "code", "required": "if_present_in_reference"}, {"key": "table", "required": "if_present_in_reference"}]
DEFAULT_PROPS = ["fontFamily", "fontSize", "lineHeight", "fontWeight", "color", "marginTop", "marginBottom", "backgroundColor", "borderRadius", "boxShadow", "borderColor"]


def load_json(root, name):
    path = root / ".uxe" / name
    if not path.exists():
        raise SystemExit(f"UXE visual failed: missing {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def evidence_dir(root):
    path = root / ".uxe" / "evidence"
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_manifest(root):
    path = evidence_dir(root) / "manifest.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("evidence", data if isinstance(data, list) else [])


def evidence_path(root, entry):
    raw = entry.get("path", "")
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_absolute() else root / path


def file_ok(path):
    return path and path.exists() and path.is_file() and path.stat().st_size > 0


def fallback_surface_files(root, surface, kind):
    base = evidence_dir(root)
    suffixes = IMAGE_SUFFIXES if kind == "screenshot" else {".json"}
    matches = []
    for path in base.glob(f"{surface}*"):
        if path.suffix.lower() in suffixes and file_ok(path):
            matches.append(path)
    return matches


def manifest_surface_ok(root, surface, entries, kind):
    for entry in entries:
        if entry.get("surface") != surface:
            continue
        if entry.get("kind") != kind:
            continue
        if file_ok(evidence_path(root, entry)):
            return True
    return False


def surface_items(surfaces_data, selected):
    items = surfaces_data.get("surfaces", [])
    if selected:
        selected_set = set(selected)
        return [item for item in items if item.get("id") in selected_set]
    return [item for item in items if item.get("requires_screenshot") or item.get("requires_computed_style")]


def has_surface_evidence(root, surface, entries, kind):
    return manifest_surface_ok(root, surface, entries, kind) or bool(fallback_surface_files(root, surface, kind))


def surface_evidence_failures(root, surfaces_data, selected, entries):
    failures = []
    for item in surface_items(surfaces_data, selected):
        surface = item["id"]
        if item.get("requires_screenshot") and not has_surface_evidence(root, surface, entries, "screenshot"):
            failures.append({"surface": surface, "kind": "screenshot"})
        if item.get("requires_computed_style") and not has_surface_evidence(root, surface, entries, "computed_style"):
            failures.append({"surface": surface, "kind": "computed_style"})
    return failures


def manifest_computed_path(root, surface, entries):
    for entry in entries:
        if entry.get("surface") == surface and entry.get("kind") == "computed_style":
            path = evidence_path(root, entry)
            if file_ok(path):
                return path
    for name in (f"{surface}.computed.json", f"{surface}.json"):
        path = evidence_dir(root) / name
        if file_ok(path):
            return path
    return None


def load_computed(root, surface, entries):
    path = manifest_computed_path(root, surface, entries)
    if not path:
        return None, "missing_computed_style"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None, "invalid_computed_json"
    if not isinstance(data.get("probes"), dict):
        return None, "missing_probe_data"
    return data, None


def px(value):
    if not isinstance(value, str) or not value.endswith("px"):
        return None
    try:
        return float(value[:-2])
    except ValueError:
        return None


def norm_weight(value):
    value = str(value or "").strip().lower()
    if value == "normal":
        return "400"
    if value == "bold":
        return "700"
    try:
        return str(int(float(value)))
    except ValueError:
        return value


def norm_color(value):
    nums = [float(n) for n in re.findall(r"[\d.]+", str(value or ""))]
    if len(nums) < 3:
        return None
    alpha = nums[3] if len(nums) > 3 else 1
    return tuple(int(round(n)) for n in nums[:3]) + (round(alpha, 3),)


def norm_fonts(value):
    parts = []
    for item in str(value or "").split(","):
        font = item.strip().strip("\"'").lower()
        if font:
            parts.append(font)
    return parts


def strings_match(a, b):
    return str(a or "").strip().lower() == str(b or "").strip().lower()


def style_matches(prop, a, b):
    if a == b:
        return True
    if prop == "fontWeight":
        return norm_weight(a) == norm_weight(b)
    if prop == "color":
        return norm_color(a) == norm_color(b)
    if prop == "fontFamily":
        af, bf = norm_fonts(a), norm_fonts(b)
        return bool(af and bf and (af[0] == bf[0] or set(af) == set(bf)))
    if prop == "lineHeight" and "normal" in {str(a).strip().lower(), str(b).strip().lower()}:
        return True
    av, bv = px(a), px(b)
    if av is not None and bv is not None:
        tolerance = 0.51 if prop in {"fontSize", "lineHeight", "marginTop", "marginBottom"} else 0
        return abs(av - bv) <= tolerance
    return strings_match(a, b)


def first_probe(data, key):
    values = data.get("probes", {}).get(key, [])
    return values[0] if values else None


def group_probes(group):
    probes = group.get("probes") or DEFAULT_PROBES
    return [item for item in probes if item.get("key")]


def reference_surface(group, surfaces):
    reference = group.get("reference")
    return reference if reference in surfaces else surfaces[0]


def reference_issue(group, surfaces):
    reference = group.get("reference")
    if reference and reference not in surfaces:
        return {"issue": "invalid_reference_surface", "reference": reference, "surfaces": surfaces}
    if not surfaces:
        return {"issue": "empty_parity_group"}
    return None


def missing_probe_diff(probe, missing):
    return [{"probe": probe["key"], "issue": "missing_probe", "surfaces": sorted(missing)}]


def compare_probe(probe, prop, surfaces, computed, reference):
    values = {surface: first_probe(computed[surface], probe["key"]) for surface in surfaces}
    required = probe.get("required", "if_present_in_reference")
    present = {surface for surface, value in values.items() if value}
    if required == "optional" or (required == "if_present_in_reference" and reference not in present):
        return []
    if required == "always" and present != set(surfaces):
        return missing_probe_diff(probe, set(surfaces) - present)
    if reference in present and present != set(surfaces):
        return missing_probe_diff(probe, set(surfaces) - present)
    base = values[reference]["styles"].get(prop, "")
    diffs, targets = [], [surface for surface in surfaces if surface != reference]
    for surface in targets:
        actual = values[surface]["styles"].get(prop, "")
        if not style_matches(prop, base, actual):
            diffs.append({"probe": probe["key"], "property": prop, reference: base, surface: actual})
    return diffs


def compare_dom(surfaces, computed, reference):
    base = computed[reference].get("dom", {}).get("semantic_tags", [])
    diffs = []
    for surface in [item for item in surfaces if item != reference]:
        actual = computed[surface].get("dom", {}).get("semantic_tags", [])
        if base != actual:
            diffs.append({"issue": "semantic_dom_mismatch", reference: base[:40], surface: actual[:40]})
    return diffs


def parity_group_ok(root, group, entries):
    surfaces = group.get("surfaces", [])
    issue = reference_issue(group, surfaces)
    if issue:
        return False, [issue]
    computed, reasons = {}, []
    for surface in surfaces:
        data, reason = load_computed(root, surface, entries)
        if reason:
            reasons.append({surface: reason})
        else:
            computed[surface] = data
    if reasons:
        return False, reasons
    props = group.get("compare_styles") or DEFAULT_PROPS
    reference = reference_surface(group, surfaces)
    diffs = compare_dom(surfaces, computed, reference)
    for probe in group_probes(group):
        for prop in props:
            diffs.extend(compare_probe(probe, prop, surfaces, computed, reference))
    if diffs:
        return False, diffs[:25]
    return True, []


def main():
    parser = argparse.ArgumentParser(description="Check UXE screenshot and parity evidence.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--surface", action="append", default=[])
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    surfaces_data = load_json(root, "surfaces.json")
    entries = load_manifest(root)
    failures = {"missing_surface_evidence": [], "missing_parity_evidence": []}
    failures["missing_surface_evidence"] = surface_evidence_failures(root, surfaces_data, args.surface, entries)
    for group in surfaces_data.get("parity_groups", []):
        ok, reasons = parity_group_ok(root, group, entries)
        if not ok:
            failures["missing_parity_evidence"].append({group["id"]: reasons})
    failures = {key: value for key, value in failures.items() if value}
    if failures:
        print("UXE visual failed")
        print(json.dumps(failures, indent=2))
        return 1
    print("UXE visual passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
