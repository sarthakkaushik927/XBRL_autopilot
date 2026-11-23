"""The standard XBRL Autopilot template (docs/17, input path 1).

The standard canonical sheets in `data/canonical_sheets/` (one .xlsx per sheet) are the source of truth
(PR #15 review). GET /indas/template serves them as one workbook, one sheet per file named after it, so a CA
fills one file and uploads it; `/indas/transform` then reads it as-is instead of guessing the layout
(`read_standard_template`). `CANONICAL_SCHEMA` lists the columns `/transform` expects on each sheet.
"""
from __future__ import annotations

import zipfile
from collections import OrderedDict
from copy import copy
from io import BytesIO
from pathlib import Path

import pandas as pd
from openpyxl import Workbook, load_workbook
from openpyxl.utils.exceptions import InvalidFileException

from src.constants import CANONICAL_SHEETS_DIR

from .indas import BS_COLS, CF_COLS, FINANCIAL_NOTES_COLS, PL_COLS, PPE_COLS, SOCIE_COLS

TEMPLATE_FILE_NAME = "XBRL_Autopilot_Standard_Template.xlsx"

CANONICAL_SCHEMA: OrderedDict[str, list[str]] = OrderedDict([
    ("CANONICAL_BS", BS_COLS),
    ("CANONICAL_PL", PL_COLS),
    ("CANONICAL_CF", CF_COLS),
    ("CANONICAL_SOCIE", SOCIE_COLS),
    ("CANONICAL_PPE_SCHEDULE", PPE_COLS),
    ("CANONICAL_FINANCIAL_NOTES", FINANCIAL_NOTES_COLS),
])


def _sheet_files(sheets_dir: Path) -> list[Path]:
    """The canonical sheet files: the six `/transform` reads first (in order), then any other sheet in the folder."""
    files = {p.stem: p for p in sorted(sheets_dir.glob("*.xlsx")) if not p.name.startswith("~$")}
    missing = [name for name in CANONICAL_SCHEMA if name not in files]
    if missing:
        raise FileNotFoundError(f"Canonical sheets missing from {sheets_dir}: {', '.join(missing)}")
    return [files.pop(name) for name in CANONICAL_SCHEMA] + list(files.values())


def _copy_sheet(src, dst) -> None:
    for row in src.iter_rows():
        for cell in row:
            out = dst.cell(row=cell.row, column=cell.column, value=cell.value)
            if cell.has_style:
                out.font, out.fill, out.border = copy(cell.font), copy(cell.fill), copy(cell.border)
                out.alignment, out.number_format = copy(cell.alignment), cell.number_format
    for key, dim in src.column_dimensions.items():
        if dim.width:
            dst.column_dimensions[key].width = dim.width
    dst.freeze_panes = src.freeze_panes


def canonical_sheets_workbook(sheets_dir: Path = CANONICAL_SHEETS_DIR) -> bytes:
    """The canonical sheet files as one .xlsx (each file's first sheet, named after the file), as served."""
    wb = Workbook()
    wb.remove(wb.active)
    for path in _sheet_files(sheets_dir):
        src = load_workbook(path)
        try:
            _copy_sheet(src.worksheets[0], wb.create_sheet(path.stem))
        finally:
            src.close()
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def is_standard_template(path: str | Path) -> bool:
    """True when the workbook has all six canonical sheets with exactly the canonical header rows."""
    try:
        wb = load_workbook(path, read_only=True, data_only=True)
    except (InvalidFileException, zipfile.BadZipFile, OSError, KeyError):
        return False
    try:
        for name, cols in CANONICAL_SCHEMA.items():
            if name not in wb.sheetnames:
                return False
            header = next(wb[name].iter_rows(min_row=1, max_row=1, values_only=True), ())
            found = [str(h).strip() if h is not None else "" for h in header[: len(cols)]]
            if found != cols:
                return False
        return True
    finally:
        wb.close()


def read_standard_template(path: str | Path) -> OrderedDict[str, pd.DataFrame]:
    """The six canonical sheets of a filled template, blank rows dropped, columns in canonical order."""
    out: OrderedDict[str, pd.DataFrame] = OrderedDict()
    for name, cols in CANONICAL_SCHEMA.items():
        df = pd.read_excel(path, sheet_name=name, dtype=object, engine="openpyxl")
        df = df.reindex(columns=cols).dropna(how="all")
        out[name] = df.reset_index(drop=True)
    return out
