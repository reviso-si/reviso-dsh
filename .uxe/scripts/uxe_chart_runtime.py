#!/usr/bin/env python3
import re

RENDERER_ALIASES = {"chart.js": "chartjs", "d3js": "d3", "g2": "antv"}


def renderer_key(renderer):
    raw = str(renderer or "").strip().lower()
    return RENDERER_ALIASES.get(raw, raw)


def js_ref_patterns(element_id):
    if not element_id:
        return []
    ident = re.escape(element_id)
    return [
        rf"document\.getElementById\(\s*[\"']{ident}[\"']\s*\)",
        rf"document\.querySelector\(\s*[\"']#{ident}[\"']\s*\)",
    ]


def js_statement(raw, start, limit=2400):
    end = min(len(raw), start + limit)
    depth = 0
    quote = ""
    escape = False
    for idx in range(start, end):
        ch = raw[idx]
        if quote:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = ""
            continue
        if ch in "\"'`":
            quote = ch
        elif ch in "({[":
            depth += 1
        elif ch in ")}]":
            depth = max(0, depth - 1)
        elif ch == ";" and depth == 0:
            return raw[start:idx + 1]
    return raw[start:end]


def dom_bound_names(raw, element_id):
    if not element_id:
        return set()
    bindings = "|".join(js_ref_patterns(element_id))
    var_re = rf"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:{bindings})"
    bound = set(re.findall(var_re, raw))
    ctx_re = rf"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:{'|'.join(bound)})\.getContext\(\s*[\"']2d[\"']\s*\)"
    return bound | (set(re.findall(ctx_re, raw)) if bound else set())


def target_patterns(raw, element_id):
    refs = js_ref_patterns(element_id)
    refs += [re.escape(name) + r"\b" for name in dom_bound_names(raw, element_id)]
    return refs


def next_reassign(raw, name, start):
    pat = rf"(?:const|let|var)?\s*{re.escape(name)}\s*="
    match = re.search(pat, raw[start:])
    return start + match.start() if match else len(raw)


def var_method_statements(raw, name, methods, start, max_count=8):
    end = next_reassign(raw, name, start)
    window = raw[start:end]
    found = []
    method_alt = "|".join(re.escape(item) for item in methods)
    pat = rf"\b{re.escape(name)}\s*\.\s*(?:{method_alt})\s*\("
    for match in re.finditer(pat, window):
        found.append(js_statement(raw, start + match.start()))
        if len(found) >= max_count:
            break
    return "".join(found)


def chartjs_snippet(raw, element_id):
    for target in target_patterns(raw, element_id):
        match = re.search(rf"new\s+Chart\s*\(\s*{target}\s*,", raw)
        if match:
            return js_statement(raw, match.start())
    return ""


def echarts_snippet(raw, element_id):
    for target in target_patterns(raw, element_id):
        assign = re.search(rf"(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*echarts\.init\s*\(\s*{target}", raw)
        if assign:
            name = assign.group(1)
            return js_statement(raw, assign.start()) + var_method_statements(raw, name, ["setOption"], assign.end(), 1)
        chain = re.search(rf"echarts\.init\s*\(\s*{target}\s*\)\s*\.\s*setOption\s*\(", raw)
        if chain:
            return js_statement(raw, chain.start())
    return ""


def antv_snippet(raw, element_id):
    if not element_id:
        return ""
    refs = [rf"[\"']{re.escape(element_id)}[\"']"] + target_patterns(raw, element_id)
    target = "|".join(refs)
    pat = rf"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:G2\.)?Chart\s*\(\s*\{{[^}}]*container\s*:\s*(?:{target})"
    match = re.search(pat, raw, re.S)
    if not match:
        return ""
    methods = ["data", "encode", "axis", "line", "area", "interval", "point", "render"]
    return js_statement(raw, match.start()) + var_method_statements(raw, match.group(1), methods, match.end())


def d3_snippet(raw, element_id):
    if not element_id:
        return ""
    refs = [rf"[\"']#{re.escape(element_id)}[\"']"] + js_ref_patterns(element_id)
    target = "|".join(refs)
    signs = ("d3.line", "d3.area", "d3.arc", "axisBottom", "axisLeft", ".data(")
    assign = re.search(rf"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*d3\.select\s*\(\s*(?:{target})\s*\)", raw)
    if assign:
        methods = ["selectAll", "data", "append", "attr", "call"]
        snippet = js_statement(raw, assign.start()) + var_method_statements(raw, assign.group(1), methods, assign.end())
        return snippet if any(sign in snippet for sign in signs) else ""
    chain = re.search(rf"d3\.select\s*\(\s*(?:{target})\s*\)\s*\.", raw)
    if not chain:
        return ""
    snippet = js_statement(raw, chain.start())
    return snippet if any(sign in snippet for sign in signs) else ""


def renderer_runtime_snippet(raw, element_id, renderer):
    key = renderer_key(renderer)
    if key == "chartjs":
        return chartjs_snippet(raw, element_id)
    if key == "echarts":
        return echarts_snippet(raw, element_id)
    if key == "antv":
        return antv_snippet(raw, element_id)
    if key == "d3":
        return d3_snippet(raw, element_id)
    return ""
