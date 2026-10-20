#!/usr/bin/env python3
import re
from uxe_chart_runtime import chartjs_snippet, renderer_key, renderer_runtime_snippet

FULL_TYPES = {"line", "bar", "area", "doughnut", "donut", "radar"}
FULL_RENDERERS = {"chartjs", "echarts", "antv", "d3"}
DEFAULT_REQUIRES = {"chart-type", "renderer", "series", "labels", "axis-or-grid"}


def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)


def attrs(node):
    return node.get("attrs", {})


def classes(node):
    return set((attrs(node).get("class") or "").split())


def evidence_name(node):
    data = attrs(node)
    raw = " ".join([data.get("class", ""), data.get("id", ""), data.get("role", "")])
    return raw.lower()


def node_text(node):
    text = node.get("text", "")
    for child in node.get("children", []):
        text += " " + node_text(child)
    return re.sub(r"\s+", " ", text).strip()


def attr_count(value):
    if not value:
        return 0
    return len([item for item in re.split(r"[,|\s]+", value) if item])


def int_attr(node, name):
    try:
        return int(attrs(node).get(name, 0))
    except (TypeError, ValueError):
        return 0


def required_set(contract):
    required = (contract or {}).get("requires")
    return set(required) if isinstance(required, list) else set(DEFAULT_REQUIRES)


def allowed_types(contract):
    declared = (contract or {}).get("fullChartTypes")
    allowed = {str(item).lower() for item in declared} if isinstance(declared, list) else set(FULL_TYPES)
    if "doughnut" in allowed: allowed.add("donut")
    return allowed


def allowed_renderers(contract):
    declared = (contract or {}).get("allowedRenderers")
    if isinstance(declared, list):
        return {renderer_key(item) for item in declared}
    return set(FULL_RENDERERS)


def renderer_allowed(renderer, contract):
    key = renderer_key(renderer)
    return key in allowed_renderers(contract) and key in FULL_RENDERERS


def svg_points(svg):
    best = 0
    for item in walk(svg):
        if item["tag"] in {"polyline", "polygon"}:
            best = max(best, attr_count(attrs(item).get("points", "")))
        if item["tag"] == "path":
            best = max(best, len(re.findall(r"[-+]?\d*\.?\d+[, ]+[-+]?\d*\.?\d+", attrs(item).get("d", ""))))
    rects = sum(1 for item in walk(svg) if item["tag"] == "rect")
    return max(best, rects)


def grouped_axis_geometry(node):
    name = evidence_name(node)
    items = [item for item in walk(node) if item is not node]
    has_line = any(item["tag"] == "line" for item in items)
    has_axis_path = any(item["tag"] == "path" and "axis" in evidence_name(item) for item in items)
    tick_text = sum(1 for item in items if item["tag"] == "text" and node_text(item))
    if "grid" in name:
        return has_line or has_axis_path
    return has_line or has_axis_path or tick_text >= 2


def svg_axis_or_grid(svg):
    if sum(1 for item in walk(svg) if item["tag"] == "line") >= 2:
        return True
    for item in walk(svg):
        name = evidence_name(item)
        if not any(word in name for word in ("axis", "grid", "tick")):
            continue
        if item["tag"] == "line":
            return True
        if item["tag"] == "path" and attrs(item).get("d"):
            return True
        if item["tag"] == "g" and grouped_axis_geometry(item):
            return True
    return False


def svg_structure(svg, chart_type, required):
    label_count = sum(1 for item in walk(svg) if item["tag"] == "text" and node_text(item))
    grid = svg_axis_or_grid(svg)
    labels = label_count >= (3 if chart_type in {"doughnut", "donut", "radar"} else 2)
    axis = grid or chart_type in {"doughnut", "donut"}
    if chart_type in {"doughnut", "donut"}:
        axis = True
    if chart_type == "radar":
        axis = grid or sum(1 for item in walk(svg) if item["tag"] == "polygon") >= 2
    checks = {"labels": labels, "axis-or-grid": axis}
    return all(checks.get(item, True) for item in required & set(checks))


def svg_chart_fit(svg, context, contract):
    min_points = int((contract or {}).get("minDataPoints", 6))
    required = required_set(contract)
    chart_type = attrs(svg).get("data-chart-type", "").lower()
    renderer = attrs(svg).get("data-chart-renderer", "")
    allowed = allowed_types(contract)
    geometry = any(item["tag"] in {"path", "polyline", "polygon", "rect"} for item in walk(svg))
    series = svg_points(svg) >= min_points and geometry
    points = svg_points(svg)
    snippet = renderer_runtime_snippet(node_text(context), attrs(svg).get("id", ""), renderer)
    checks = {"chart-type": chart_type in allowed, "renderer": bool(snippet) and renderer_allowed(renderer, contract), "series": series}
    checks["labels"] = svg_structure(svg, chart_type, {"labels"})
    checks["axis-or-grid"] = svg_structure(svg, chart_type, {"axis-or-grid"})
    ok = all(checks.get(item, False) for item in required)
    ok = ok and (not chart_type or chart_type in allowed)
    return {"ok": ok, "type": chart_type, "renderer": renderer, "points": points}


def js_array_item_count(raw):
    if "{" in raw:
        return raw.count("{")
    items = [item for item in re.split(r"\s*,\s*", raw.strip()) if item.strip()]
    return len(items)


def js_array_count(script, name):
    match = re.search(rf"{name}\s*:\s*\[([^\]]*)\]", script)
    return js_array_item_count(match.group(1)) if match else 0


def js_series_count(snippet, renderer):
    key = renderer_key(renderer)
    if key == "antv":
        match = re.search(r"\.data\s*\(\s*\[([^\]]*)\]", snippet, re.S)
        return js_array_item_count(match.group(1)) if match else 0
    match = re.search(r"series\s*:\s*\[.*?data\s*:\s*\[([^\]]*)\]", snippet, re.S)
    if key == "echarts" and match:
        return js_array_item_count(match.group(1))
    if key == "echarts":
        return 0
    return js_array_count(snippet, "data")


def js_label_count(snippet, renderer):
    key = renderer_key(renderer)
    if key == "echarts":
        match = re.search(r"xAxis\s*:\s*(?:\{|\[).*?data\s*:\s*\[([^\]]*)\]", snippet, re.S)
        return js_array_item_count(match.group(1)) if match else 0
    if key == "antv":
        return js_series_count(snippet, renderer) if re.search(r"\.encode\s*\(\s*[\"']x", snippet) else 0
    return js_array_count(snippet, "labels")


def chart_axis_or_grid(snippet, renderer, radial):
    key = renderer_key(renderer)
    if radial:
        return True
    if key == "chartjs":
        return "scales" in snippet
    if key == "echarts":
        return "xAxis" in snippet and "yAxis" in snippet
    if key == "antv":
        return "axis" in snippet or "encode" in snippet
    if key == "d3":
        return "axisBottom" in snippet or "axisLeft" in snippet
    return False


def element_chart_fit(element, context, contract):
    raw = node_text(context)
    element_id = attrs(element).get("id", "")
    renderer = attrs(element).get("data-chart-renderer", "")
    snippet = renderer_runtime_snippet(raw, element_id, renderer)
    if not snippet and not renderer:
        snippet = chartjs_snippet(raw, element_id)
    min_points = int((contract or {}).get("minDataPoints", 6))
    required = required_set(contract)
    chart_type = attrs(element).get("data-chart-type", "").lower()
    has_runtime = bool(snippet)
    if not renderer and has_runtime:
        renderer = "chartjs"
    if not chart_type:
        match = re.search(r"type\s*:\s*[\"'](\w+)[\"']", snippet)
        chart_type = match.group(1).lower() if match else ""
    points = js_series_count(snippet, renderer)
    labels = js_label_count(snippet, renderer)
    radial = chart_type in {"doughnut", "donut", "radar"}
    checks = {
        "chart-type": chart_type in allowed_types(contract),
        "renderer": has_runtime and renderer_allowed(renderer, contract),
        "series": points >= min_points,
        "labels": labels >= (3 if radial else 2),
        "axis-or-grid": chart_axis_or_grid(snippet, renderer, radial),
    }
    ok = all(checks.get(item, False) for item in required)
    ok = ok and (not chart_type or checks["chart-type"])
    return {"ok": ok, "type": chart_type, "renderer": renderer, "points": points}


def full_chart_fit(node, contract=None):
    best = {"ok": False, "type": "", "renderer": "", "points": 0}
    for item in walk(node):
        if item["tag"] == "svg":
            result = svg_chart_fit(item, node, contract)
        elif item["tag"] == "canvas" or attrs(item).get("data-chart-renderer"):
            result = element_chart_fit(item, node, contract)
        else:
            continue
        if result["ok"] or result["points"] > best["points"]:
            best = result
        if best["ok"]:
            break
    return best
