"""Lines of one statement tagged with the same concept are one fact: their amounts are added (webXBRL's
"Add", docs/13 §11.3), e.g. several cash-flow lines tagged "Other adjustments for non-cash items".

Exact decimals; a whole-number sum stays an int. Lines with a different period role (opening vs closing) are
different facts and are not merged.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def _dec(v: Any) -> Decimal | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def _out(d: Decimal) -> int | float:
    return int(d) if d == d.to_integral_value() else float(d)


def merge_lines(rows: list[dict[str, Any]], as_decimal: bool = False) -> list[dict[str, Any]]:
    """Same (concept, periodRole) within the list -> one row with summed cy / py, first row's position kept.

    `as_decimal`: amounts stay Decimal (the Difference check); otherwise int when whole (the XML pipeline).
    """
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    order: list[tuple[str, str]] = []
    for r in rows:
        concept = r.get("concept")
        if not concept:
            continue
        key = (concept, r.get("periodRole") or "end")
        if key not in merged:
            merged[key] = {**r, "_count": 0}
            merged[key]["cy"] = merged[key]["py"] = None
            order.append(key)
        m = merged[key]
        m["_count"] += 1
        for year in ("cy", "py"):
            v = _dec(r.get(year))
            if v is not None:
                prev = _dec(m.get(year))
                total = v if prev is None else prev + v
                m[year] = total if as_decimal else _out(total)
    out = []
    for key in order:
        m = merged[key]
        m.pop("_count", None)
        out.append(m)
    return out
