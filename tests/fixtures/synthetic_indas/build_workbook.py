"""Write the synthetic filing (filing.json) as a filled standard template.

Usage: uv run python -m tests.fixtures.synthetic_indas.build_workbook [out.xlsx]
(default: tests/fixtures/synthetic_indas/synthetic_indas_template.xlsx, the file the e2e uploads).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from openpyxl import Workbook

from src.transformation.template import CANONICAL_SCHEMA

HERE = Path(__file__).parent
FILING = HERE / "filing.json"
DEFAULT_OUT = HERE / "synthetic_indas_template.xlsx"


def _cells(sheet: str, i: int, r: dict) -> dict[str, object]:
    if sheet == "CANONICAL_PPE_SCHEDULE":
        return {"Asset_Class": r["assetClass"], **r["amounts"]}
    return {
        "Row_Index": i,
        "Line_Item": r["label"],
        "Breadcrumb_Hierarchy": r.get("breadcrumb") or None,
        "Note_No": r.get("note"),
        "Current_Year_Amount": r.get("cy"),
        "Previous_Year_Amount": r.get("py"),
    }


def build_workbook(out: Path = DEFAULT_OUT) -> Path:
    filing = json.loads(FILING.read_text(encoding="utf-8"))
    wb = Workbook()
    wb.remove(wb.active)
    for sheet, cols in CANONICAL_SCHEMA.items():
        ws = wb.create_sheet(sheet)
        ws.append(cols)
        for i, row in enumerate(filing["sheets"].get(sheet, []), start=1):
            cells = _cells(sheet, i, row)
            ws.append([cells.get(c) for c in cols])
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(out)
    return out


if __name__ == "__main__":
    print(build_workbook(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT))
