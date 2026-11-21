"""ELR scoping for tag suggestions (docs/15 §3 "The ELR Scoping Filter", docs/17).

Vashu's rule: never search all 5,647 concepts; search only the active sheet's ELR. The vector index has no `elr`
metadata yet, so the scope is taken from the knowledge base (presentation / definition linkbases) instead and the
candidates are reranked directly. The sheet -> ELR table is the one in docs/15 §5.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any, Iterable

from langchain_core.documents import Document

# docs/15 §5: which ELRs each canonical sheet is tagged against.
SHEET_ELRS: dict[str, tuple[str, ...]] = {
    "CANONICAL_BS": ("110000",),
    "CANONICAL_PL": ("210000", "210000a"),
    "CANONICAL_CF": ("310000", "320000"),  # direct and indirect method
    "CANONICAL_SOCIE": ("400200",),
    "CANONICAL_PPE_SCHEDULE": ("400600",),
}
# Notes are tagged against every note ELR (4xxxxx-6xxxxx), the statements excluded.
NOTE_ELR_PREFIXES = ("4", "5", "6")

# The axis whose members a table sheet's rows are (docs/15 §4.4, §4.5).
SHEET_AXES: dict[str, tuple[str, str]] = {
    "CANONICAL_SOCIE": ("400200", "ind-as:ComponentsOfEquityAxis"),
    "CANONICAL_PPE_SCHEDULE": ("400600", "ind-as:ClassesOfPropertyPlantAndEquipmentAxis"),
}

# Item types that never hold a statement amount (doc 15: "monetaryItemType only" for statement tabs).
NON_NUMERIC_TYPES = frozenset({"textBlockItemType", "stringItemType", "dateItemType", "booleanItemType"})
STRUCTURAL_SUFFIXES = ("Abstract", "Axis", "Member", "Table", "Domain", "LineItems")


def sheet_elrs(kb: dict[str, Any], sheet: str) -> list[str]:
    if sheet == "CANONICAL_FINANCIAL_NOTES":
        statements = {e for elrs in SHEET_ELRS.values() for e in elrs}
        return [e for e in kb.get("presentation", {}) if e.startswith(NOTE_ELR_PREFIXES) and e not in statements]
    if sheet not in SHEET_ELRS:
        raise ValueError(f"Unknown sheet: {sheet}")
    return list(SHEET_ELRS[sheet])


def _taggable(kb: dict[str, Any], qname: str) -> bool:
    c = kb.get("concepts", {}).get(qname)
    if not c or c.get("abstract") is True or str(c.get("abstract")).lower() == "true":
        return False
    if qname.endswith(STRUCTURAL_SUFFIXES):
        return False
    return c.get("type") not in NON_NUMERIC_TYPES


def scope_concepts(kb: dict[str, Any], sheet: str) -> list[str]:
    """Non-abstract numeric concepts in the sheet's ELRs, in presentation order, no duplicates."""
    seen: dict[str, None] = {}
    for elr in sheet_elrs(kb, sheet):
        for arc in kb.get("presentation", {}).get(elr, []):
            for q in (arc["from"], arc["to"]):
                if q not in seen and _taggable(kb, q):
                    seen[q] = None
    return list(seen)


def axis_members(kb: dict[str, Any], sheet: str) -> list[str]:
    """The members of the sheet's table axis (all levels below its domain), in definition order."""
    if sheet not in SHEET_AXES:
        raise ValueError(f"No table axis for sheet: {sheet}")
    elr, axis = SHEET_AXES[sheet]
    arcs = kb.get("definition", {}).get(elr, [])
    domains = [a["to"] for a in arcs if a["arcrole"] == "dimension-domain" and a["from"] == axis]
    children: dict[str, list[str]] = {}
    for a in arcs:
        if a["arcrole"] == "domain-member":
            children.setdefault(a["from"], []).append(a["to"])
    out: list[str] = []
    stack = list(reversed(domains))
    while stack:
        m = stack.pop()
        if m not in out:
            out.append(m)
            stack.extend(reversed(children.get(m, [])))
    return out


def concept_document(kb: dict[str, Any], qname: str) -> Document:
    """A candidate in the same shape as the vector index's documents ("label | qname | name")."""
    c = kb.get("concepts", {}).get(qname, {})
    label = (c.get("labels") or {}).get("label") or c.get("name") or qname
    meta = {k: c.get(k) for k in ("qname", "name", "prefix", "type", "periodType", "balance", "abstract")}
    meta.update({"qname": qname, "labels": {"label": label}})
    return Document(page_content=f"{label} | {qname} | {c.get('name') or qname.split(':')[-1]}", metadata=meta)


def scope_documents(kb: dict[str, Any], qnames: Iterable[str]) -> list[Document]:
    return [concept_document(kb, q) for q in qnames]


@lru_cache(maxsize=None)
def _cached_kb() -> dict[str, Any]:
    import json

    from src.constants import INDAS_OUTPUT_JSON_PATH

    with open(INDAS_OUTPUT_JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


def knowledge_base() -> dict[str, Any]:
    """The Ind AS knowledge base, loaded once per sidecar process."""
    return _cached_kb()
