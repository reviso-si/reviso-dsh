#!/usr/bin/env python3
"""Deterministic page capability fit checks for UXE surfaces."""
import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from uxe_chart_anatomy import full_chart_fit
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
METRIC_CLASSES = {"metric-grid", "kpi-grid", "stat-grid"}
METRIC_CARD_CLASSES = {"metric-card", "ant-stat-card", "kpi-card", "stat-card"}
PRIMARY_CLASSES = {"trend-card", "analysis-panel", "primary-analysis-panel"}
SECONDARY_CLASSES = {"mid-row", "bottom-row", "secondary-insight-grid"}
RANKING_CLASSES = {"ranking-panel", "ranking-list", "store-ranking"}
class TreeParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = {"tag": "document", "attrs": {}, "children": [], "text": ""}
        self.stack = [self.root]
    def handle_starttag(self, tag, attrs):
        node = {"tag": tag.lower(), "attrs": dict(attrs), "children": [], "text": ""}
        self.stack[-1]["children"].append(node)
        if tag.lower() not in VOID:
            self.stack.append(node)
    def handle_endtag(self, tag):
        tag = tag.lower()
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i]["tag"] == tag:
                del self.stack[i:]
                return
    def handle_data(self, data):
        self.stack[-1]["text"] += data
def walk(node):
    yield node
    for child in node.get("children", []):
        yield from walk(child)
def classes(node):
    return set((node.get("attrs", {}).get("class") or "").split())
def node_text(node):
    text = node.get("text", "")
    for child in node.get("children", []):
        text += " " + node_text(child)
    return re.sub(r"\s+", " ", text).strip()
def has_class(node, names):
    return bool(classes(node) & set(names))
def descendants(node, predicate):
    return [item for item in walk(node) if item is not node and predicate(item)]
def parse_html(text):
    parser = TreeParser()
    parser.feed(text)
    return parser.root
def region_nodes(root, region, class_names):
    found = []
    for node in walk(root):
        attrs = node.get("attrs", {})
        if attrs.get("data-contract-region") == region or has_class(node, class_names):
            found.append(node)
    return found
def has_desc(node, tag=None, class_names=None):
    names = set(class_names or [])
    for item in descendants(node, lambda _: True):
        if tag and item["tag"] == tag:
            return True
        if names and has_class(item, names):
            return True
    return False
def card_quality(card):
    text = node_text(card).lower()
    tags = [item["tag"] for item in walk(card)]
    cls = set().union(*(classes(item) for item in walk(card)))
    checks = [
        bool(cls & {"metric-label", "metric-title", "ant-stat-card-title", "stat-title"}),
        bool(cls & {"metric-value", "ant-stat-card-value", "stat-value"}) or bool(re.search(r"[$&yen;]?\d[\d,.]*%?", text)),
        bool(cls & {"metric-delta", "ant-stat-card-trend", "trend", "delta", "up", "down"}) or "%" in text,
        bool(cls & {"metric-footer", "detail", "secondary"}) or any(word in text for word in ("daily", "target", "last", "vs ")),
        "svg" in tags or "canvas" in tags or bool(cls & {"sparkline", "progress-track", "metric-chart"}),
    ]
    return sum(1 for item in checks if item) / len(checks)
def metric_summary(root):
    rows = region_nodes(root, "metric-summary-row", METRIC_CLASSES)
    best = {"score": 0, "count": 0}
    for row in rows:
        cards = descendants(row, lambda n: has_class(n, METRIC_CARD_CLASSES))
        if not cards:
            cards = [c for c in row.get("children", []) if c["tag"] in {"article", "div", "section"}]
        count_score = 1 if 3 <= len(cards) <= 5 else min(len(cards) / 3, 1)
        anatomy = sum(card_quality(card) for card in cards[:5]) / max(1, min(len(cards), 5))
        score = round((count_score * 0.4) + (anatomy * 0.6), 3)
        if score > best["score"]:
            best = {"score": score, "count": len(cards)}
    return best
def ranking_fit(node):
    panels = region_nodes(node, "adjacent-ranking-insight", RANKING_CLASSES)
    for panel in panels:
        items = descendants(panel, lambda n: has_class(n, {"ranking-item", "ranking-badge"}))
        if len(items) >= 3:
            return True
        if panel["tag"] in {"ol", "ul"} and len(descendants(panel, lambda n: n["tag"] == "li")) >= 3:
            return True
    return False
def required_region_present(root, region):
    if region == "metric-summary-row":
        return bool(region_nodes(root, region, METRIC_CLASSES))
    if region == "primary-analysis-panel":
        return bool(region_nodes(root, region, PRIMARY_CLASSES) + region_nodes(root, region, {"chart-row"}))
    if region == "adjacent-ranking-insight":
        return ranking_fit(root)
    if region == "secondary-insight-grid":
        return bool(region_nodes(root, region, SECONDARY_CLASSES))
    return bool(region_nodes(root, region, {region}))
def control_band_fit(node):
    buttons = descendants(node, lambda n: n["tag"] == "button")
    tabs = descendants(node, lambda n: has_class(n, {"tabs", "tab"}) or n.get("attrs", {}).get("role") == "tab")
    text = node_text(node).lower()
    time_words = sum(1 for word in ("today", "week", "month", "year", "date") if word in text)
    return len(buttons) >= 2 or len(tabs) >= 2 or time_words >= 2
def primary_panel(root, contract=None):
    candidates = region_nodes(root, "primary-analysis-panel", PRIMARY_CLASSES)
    candidates += region_nodes(root, "primary-analysis-panel", {"chart-row"})
    best = {"score": 0, "ranking": False, "controls": False, "chart": False, "chartEvidence": {}}
    for node in candidates:
        chart_evidence = full_chart_fit(node, (contract or {}).get("chartAnatomy", {}))
        chart = chart_evidence["ok"]
        ranking = ranking_fit(node)
        controls = control_band_fit(node)
        header = has_desc(node, class_names={"card-header", "ant-card-head"}) or has_class(node, {"card-header", "ant-card-head"})
        score = sum([0.25 if chart else 0, 0.35 if ranking else 0, 0.25 if controls else 0, 0.15 if header else 0])
        if score > best["score"]:
            best = {"score": round(score, 3), "ranking": ranking, "controls": controls, "chart": chart, "chartEvidence": chart_evidence}
    return best
def secondary_insights(root):
    nodes = region_nodes(root, "secondary-insight-grid", SECONDARY_CLASSES)
    best = {"score": 0, "signals": []}
    for node in nodes:
        text = node_text(node).lower()
        signals = []
        if any(word in text for word in ("keyword", "search", "hot")):
            signals.append("keyword")
        if any(word in text for word in ("category", "ratio", "donut", "pie")) or has_desc(node, class_names={"donut-wrap"}):
            signals.append("category")
        if has_desc(node, "table") or has_desc(node, class_names={"data-table", "ant-table"}):
            signals.append("table")
        score = min(len(set(signals)) / 2, 1)
        if score > best["score"]:
            best = {"score": round(score, 3), "signals": sorted(set(signals))}
    return best
def page_fit(root, contract):
    metric = metric_summary(root)
    primary = primary_panel(root, contract)
    secondary = secondary_insights(root)
    weights = contract.get("weights", {})
    score = (
        metric["score"] * weights.get("metricSummaryRow", 0.25)
        + primary["score"] * weights.get("primaryAnalysisPanel", 0.5)
        + secondary["score"] * weights.get("secondaryInsights", 0.25)
    )
    failures = []
    if metric["score"] < 0.75:
        failures.append("metric-summary-row anatomy incomplete")
    if not primary["ranking"]:
        failures.append("missing adjacent-ranking-insight")
    if not primary["controls"]:
        failures.append("primary-analysis-panel has no control band")
    if not primary["chart"]:
        failures.append("primary-analysis-panel chart anatomy incomplete")
    if secondary["score"] < 1:
        failures.append("secondary-insight-grid incomplete")
    for region in contract.get("requiredRegions", []):
        if not required_region_present(root, region):
            failures.append(f"missing {region}")
    anti = set(contract.get("antiPatterns", []))
    markers = [n for n in walk(root) if n.get("attrs", {}).get("data-contract-region")]
    ranking_nodes = region_nodes(root, "adjacent-ranking-insight", RANKING_CLASSES)
    if "generic-four-kpi-plus-isolated-chart" in anti and metric["score"] >= 0.75 and not primary["ranking"]:
        failures.append("anti-pattern: generic-four-kpi-plus-isolated-chart")
    if "marker-without-anatomy" in anti and markers and (metric["score"] < 0.75 or secondary["score"] < 1):
        failures.append("anti-pattern: marker-without-anatomy")
    if "ranking-as-full-table" in anti and any(has_desc(n, "table") for n in ranking_nodes) and not primary["ranking"]:
        failures.append("anti-pattern: ranking-as-full-table")
    if "primary-chart-without-control-band" in anti and primary["chart"] and not primary["controls"]:
        failures.append("anti-pattern: primary-chart-without-control-band")
    return {"score": round(score, 3), "failures": failures, "evidence": {"metric": metric, "primary": primary, "secondary": secondary}}
def signal_present(term, text, cls, tags):
    return term in tags or term in cls or term in text or any(term in item for item in cls)
def grammar_fit(root, grammar):
    text = node_text(root).lower()
    cls = set().union(*(classes(item) for item in walk(root)))
    tags = [item["tag"] for item in walk(root)]
    signals = grammar.get("signals", {})
    shell_terms = signals.get("shell", ["aside", "nav", "header", "breadcrumb"])
    anatomy_terms = signals.get("cardAnatomy", ["card-header", "card-body", "ant-card-head", "ant-card-body"])
    density_terms = signals.get("enterpriseDensity", ["card", "table", "chart", "metric", "ranking"])
    hero_terms = signals.get("antiMarketing", ["hero"])
    shell = sum(1 for term in shell_terms if signal_present(term, text, cls, tags))
    anatomy = sum(1 for term in anatomy_terms if signal_present(term, text, cls, tags))
    density = sum(1 for term in density_terms if signal_present(term, text, cls, tags))
    hero_penalty = 0.25 if any(signal_present(term, text, cls, tags) for term in hero_terms) else 0
    score = (min(shell / 4, 1) * 0.3) + (min(anatomy / 2, 1) * 0.3) + (min(density / 4, 1) * 0.4) - hero_penalty
    anti = set(grammar.get("antiPatterns", []))
    failures = []
    if shell < 3:
        failures.append("sider/header enterprise shell incomplete")
        if "siderless-enterprise-dashboard" in anti:
            failures.append("siderless-enterprise-dashboard")
    if anatomy < 2:
        failures.append("cards-without-head-body-anatomy")
    if hero_penalty:
        failures.append("marketing-hero-as-app-page")
    return {"score": round(max(score, 0), 3), "failures": failures, "grammar": grammar.get("id", "custom")}
def load_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
def asset(root, kind, name):
    suffix = ".contract.json" if kind == "page-capabilities" else ".grammar.json"
    names = [f"{name}.json", f"{name}{suffix}"]
    bases = [root / ".uxe" / kind, root / ".uxe" / "seeds" / kind, Path(__file__).resolve().parent.parent / "seeds" / kind]
    for base in bases:
        for file_name in names:
            path = base / file_name
            if path.exists():
                return load_json(path, {}), str(path)
    return None, ""
def manifest_targets(root, args):
    if args.entry:
        return [{"id": "page", "entry": args.entry, "pageCapability": args.capability, "componentGrammar": args.grammar}]
    path = root / ".uxe" / "page-capability-manifest.json"
    if not path.exists():
        return []
    data = load_json(path, {})
    return data.get("targets") or data.get("surfaces") or data.get("pages") or []
def target_text(root, target):
    for key in ("domSnapshot", "renderedDom", "entry", "artifact", "path", "file"):
        value = target.get(key)
        if not value:
            continue
        path = (root / value).resolve()
        if path.exists() and path.is_relative_to(root):
            return path.read_text(encoding="utf-8", errors="ignore")
    return ""
def evaluate(root, target):
    capability = target.get("pageCapability") or target.get("page_capability") or "dashboard-analysis"
    grammar_id = target.get("componentGrammar") or target.get("component_grammar") or "ant-pro-enterprise"
    contract, contract_path = asset(root, "page-capabilities", capability)
    grammar, grammar_path = asset(root, "component-grammars", grammar_id)
    missing = []
    if contract is None:
        missing.append(f"unknown page capability: {capability}")
        contract = {"id": capability, "minScore": 0.8}
    if grammar is None:
        missing.append(f"unknown component grammar: {grammar_id}")
        grammar = {"id": grammar_id, "minScore": 0.75}
    tree = parse_html(target_text(root, target))
    page = page_fit(tree, contract)
    grammar_result = grammar_fit(tree, grammar)
    return {
        "id": target.get("id", "page"),
        "pageCapability": capability,
        "componentGrammar": grammar_id,
        "pageCapabilityFit": page["score"],
        "componentGrammarFit": grammar_result["score"],
        "pageCapabilityMinScore": contract.get("minScore", 0.8),
        "componentGrammarMinScore": grammar.get("minScore", 0.75),
        "failures": missing + page["failures"] + grammar_result["failures"],
        "evidence": {"page": page["evidence"], "grammar": grammar_result, "assets": {"contract": contract_path, "grammar": grammar_path}},
    }
def failed(item):
    return item["failures"] or item["pageCapabilityFit"] < item["pageCapabilityMinScore"] or item["componentGrammarFit"] < item["componentGrammarMinScore"]
def write_report(root, report):
    out = root / ".uxe" / "evidence"
    out.mkdir(parents=True, exist_ok=True)
    (out / "page-capability-fit.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
def main():
    parser = argparse.ArgumentParser(description="Run UXE page capability fit checks.")
    parser.add_argument("--project-root", default=".")
    parser.add_argument("--entry", default="")
    parser.add_argument("--capability", default="dashboard-analysis")
    parser.add_argument("--grammar", default="ant-pro-enterprise")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    targets = manifest_targets(root, args)
    results = [evaluate(root, target) for target in targets]
    failures = [item for item in results if failed(item)]
    report = {"version": 1, "targets": results, "pass": not failures, "skipped": not targets}
    write_report(root, report)
    if failures:
        print("UXE page capability failed")
        print(json.dumps(report, indent=2))
        return 1
    print("UXE page capability passed")
    print(json.dumps(report, indent=2))
    return 0
if __name__ == "__main__":
    raise SystemExit(main())
