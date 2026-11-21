"""Live Difference check for the tagging split view (docs/15 §5 "Diff = 0.00 check bar", Webtel's Difference footer).

The same calculation relationships /generateXML's validator uses (knowledge base `calculation`), but run on the
tagged lines only and in exact decimals: per parent, the reported total vs the sum of its tagged children, and
Assets vs Equity and liabilities. Totals with no tagged children are not checked (nothing to compare).
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

TOLERANCE = Decimal("1")  # MCA's 1 INR rounding tolerance, as in the validator


def _dec(v: Any) -> Decimal | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def _facts(rows: list[dict[str, Any]], year: str) -> dict[str, Decimal]:
    out: dict[str, Decimal] = {}
    for r in rows:
        if r.get("concept") and r.get("periodRole") != "start":
            v = _dec(r.get(year))
            if v is not None:
                out[r["concept"]] = v
    return out


def check(kb: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    """rows: [{concept, cy, py, periodRole?}] -> {differences: [...], total: str} (amounts as decimal strings)."""
    labels = {q: (c.get("labels") or {}).get("label") or q for q, c in kb.get("concepts", {}).items()}
    diffs: list[dict[str, Any]] = []
    for year in ("cy", "py"):
        facts = _facts(rows, year)
        seen: set[str] = set()
        for elr, eqs in kb.get("calculation", {}).items():
            by_parent: dict[str, list[dict[str, Any]]] = {}
            for eq in eqs:
                by_parent.setdefault(eq["from"], []).append(eq)
            for parent, children in by_parent.items():
                if parent not in facts or parent in seen:
                    continue
                present = [ch for ch in children if ch["to"] in facts]
                if not present:
                    continue
                seen.add(parent)
                total = sum((facts[ch["to"]] * Decimal(str(ch["weight"])) for ch in present), Decimal(0))
                gap = facts[parent] - total
                if abs(gap) > TOLERANCE:
                    diffs.append({
                        "year": year.upper(),
                        "elr": elr,
                        "concept": parent,
                        "label": labels.get(parent, parent),
                        "reported": str(facts[parent]),
                        "calculated": str(total),
                        "difference": str(gap),
                        "children": [ch["to"] for ch in present],
                    })
        assets, eq_liab = facts.get("ind-as:Assets"), facts.get("ind-as:EquityAndLiabilities")
        if assets is not None and eq_liab is not None and abs(assets - eq_liab) > TOLERANCE:
            diffs.append({
                "year": year.upper(),
                "elr": "110000",
                "concept": "ind-as:Assets",
                "label": "Balance sheet does not balance (Assets − Equity and liabilities)",
                "reported": str(assets),
                "calculated": str(eq_liab),
                "difference": str(assets - eq_liab),
                "children": ["ind-as:EquityAndLiabilities"],
            })
    total = sum((abs(Decimal(d["difference"])) for d in diffs), Decimal(0))
    return {"differences": diffs, "total": str(total)}
