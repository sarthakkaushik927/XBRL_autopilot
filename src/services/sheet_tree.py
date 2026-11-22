"""The taxonomy side of the tagging split view (docs/15 §5: "Right pane: Presentation Tree 110000 …").

For a canonical sheet: one presentation tree per ELR in its scope (sheet_scope.py), flattened in presentation
order with depths; for a table sheet's axis: its member hierarchy. From the knowledge base only.
"""
from __future__ import annotations

from typing import Any

from src.services.sheet_scope import SHEET_AXES, TEXT_BLOCKS, axis_members, sheet_elrs


def _mandatory(kb: dict[str, Any], elr: str | None, qname: str) -> bool:
    """MCA's mandatory rule for this ELR (businessRules.mandatoryByELR), else the concept's own flag."""
    by_elr = kb.get("businessRules", {}).get("mandatoryByELR", {})
    if elr and elr in by_elr:
        return qname in by_elr[elr]
    return bool(kb.get("concepts", {}).get(qname, {}).get("isMandatory"))


def _node(kb: dict[str, Any], qname: str, depth: int, elr: str | None = None) -> dict[str, Any]:
    c = kb.get("concepts", {}).get(qname, {})
    abstract = c.get("abstract") is True or str(c.get("abstract")).lower() == "true" or qname.endswith(("Abstract", "Table", "Axis", "Domain", "LineItems"))
    return {
        "qname": qname,
        "label": (c.get("labels") or {}).get("label") or c.get("name") or qname.split(":")[-1],
        "depth": depth,
        "abstract": bool(abstract),
        "type": c.get("type"),
        "periodType": c.get("periodType"),
        "balance": c.get("balance"),
        # webXBRL shows mandatory lines red until tagged (docs/13 §11.3)
        "mandatory": (not abstract) and _mandatory(kb, elr, qname),
    }


def presentation_tree(kb: dict[str, Any], elr: str) -> list[dict[str, Any]]:
    """The ELR's presentation hierarchy, depth-first in arc order (members and axes are left out)."""
    arcs = kb.get("presentation", {}).get(elr, [])
    children: dict[str, list[tuple[float, str]]] = {}
    tos = set()
    for a in arcs:
        children.setdefault(a["from"], []).append((float(a.get("order") or 0), a["to"]))
        tos.add(a["to"])
    roots = [q for q in children if q not in tos]
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    def walk(q: str, depth: int) -> None:
        if q in seen or q.endswith(("Member", "Axis", "Domain")):
            return
        seen.add(q)
        out.append(_node(kb, q, depth, elr))
        for _, child in sorted(children.get(q, [])):
            walk(child, depth + 1)

    for r in roots:
        walk(r, 0)
    return out


def member_tree(kb: dict[str, Any], sheet: str) -> list[dict[str, Any]]:
    elr, axis = SHEET_AXES[sheet]
    arcs = kb.get("definition", {}).get(elr, [])
    parent: dict[str, str] = {}
    for a in arcs:
        if a["arcrole"] == "domain-member":
            parent.setdefault(a["to"], a["from"])
    depth = lambda m: 0 if m not in parent else 1 + depth(parent[m])  # noqa: E731
    return [{**_node(kb, m, depth(m)), "abstract": False} for m in axis_members(kb, sheet)]


def sheet_trees(kb: dict[str, Any], sheet: str, kind: str = "concept") -> list[dict[str, Any]]:
    """[{elr, title, nodes}] for the split view's right pane."""
    if kind == "member":
        _, axis = SHEET_AXES[sheet]
        title = _node(kb, axis, 0)["label"]
        return [{"elr": SHEET_AXES[sheet][0], "title": title, "nodes": member_tree(kb, sheet)}]
    trees = []
    for elr in sheet_elrs(kb, sheet):
        nodes = presentation_tree(kb, elr)
        if sheet == TEXT_BLOCKS:
            nodes = [n for n in nodes if n["type"] == "textBlockItemType"]
        if nodes:
            trees.append({"elr": elr, "title": nodes[0]["label"], "nodes": nodes})
    return trees
