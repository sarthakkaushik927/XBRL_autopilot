"""Standard template (docs/17, input path 1): the canonical sheets as served, filled and read back through /indas/transform."""
import asyncio
import pathlib
import pickle
from io import BytesIO

from openpyxl import load_workbook

from src.pipeline.indas_transformation import IndasTransformationPipeline
import pytest

from src.constants import CANONICAL_SHEETS_DIR
from src.transformation.template import (
    CANONICAL_SCHEMA,
    canonical_sheets_workbook,
    is_standard_template,
    read_standard_template,
)
from src.utils.main_utils import load_object


def _write_template(path: pathlib.Path) -> None:
    """A blank template: the served headers, example rows removed."""
    wb = load_workbook(BytesIO(canonical_sheets_workbook()))
    for ws in wb.worksheets:
        if ws.max_row > 1:
            ws.delete_rows(2, ws.max_row)
    wb.save(path)


def test_template_serves_the_canonical_sheet_files_as_they_are():
    wb = load_workbook(BytesIO(canonical_sheets_workbook()))
    files = sorted(p.stem for p in CANONICAL_SHEETS_DIR.glob("*.xlsx"))
    # the six sheets /transform reads first, then the other canonical sheets (e.g. CANONICAL_NOTES)
    assert wb.sheetnames[: len(CANONICAL_SCHEMA)] == list(CANONICAL_SCHEMA)
    assert sorted(wb.sheetnames) == files
    for name in wb.sheetnames:
        src = load_workbook(CANONICAL_SHEETS_DIR / f"{name}.xlsx").worksheets[0]
        assert [list(r) for r in wb[name].iter_rows(values_only=True)] == [list(r) for r in src.iter_rows(values_only=True)]
    for name, cols in CANONICAL_SCHEMA.items():
        assert [c.value for c in wb[name][1]][: len(cols)] == cols


def test_the_served_template_is_recognised_as_is(tmp_path):
    f = tmp_path / "served.xlsx"
    f.write_bytes(canonical_sheets_workbook())
    assert is_standard_template(f)


def test_a_missing_canonical_sheet_is_reported(tmp_path):
    with pytest.raises(FileNotFoundError, match="CANONICAL_BS"):
        canonical_sheets_workbook(tmp_path)


def test_blank_template_is_recognised(tmp_path):
    f = tmp_path / "t.xlsx"
    _write_template(f)
    assert is_standard_template(f)


def test_a_client_workbook_is_not_a_template(tmp_path):
    f = tmp_path / "t.xlsx"
    _write_template(f)
    wb = load_workbook(f)
    wb["CANONICAL_BS"]["B1"] = "Particulars"
    wb.save(f)
    assert not is_standard_template(f)
    assert not is_standard_template(tmp_path / "missing.xlsx")


def _filled(tmp_path) -> pathlib.Path:
    f = tmp_path / "filled.xlsx"
    _write_template(f)
    wb = load_workbook(f)
    ws = wb["CANONICAL_BS"]
    ws.append([1, "Property, plant and equipment", "Assets > Non-current assets", "3", 1500000, 1200000])
    ws.append([None, None, None, None, None, None])
    ws.append([2, "Total assets", "Assets", None, 1500000, 1200000])
    wb["CANONICAL_PL"].append([1, "Revenue from operations", "Income", "18", 9000000, None])
    wb.save(f)
    return f


def test_filled_template_reads_back_rows_and_drops_blank_lines(tmp_path):
    sheets = read_standard_template(_filled(tmp_path))
    assert list(sheets) == list(CANONICAL_SCHEMA)
    bs = sheets["CANONICAL_BS"]
    assert bs["Line_Item"].tolist() == ["Property, plant and equipment", "Total assets"]
    assert sheets["CANONICAL_CF"].empty


def test_transform_passes_a_filled_template_through_without_heuristics(tmp_path):
    out = tmp_path / "out" / "CANONICAL_MASTER.xlsx"
    out.parent.mkdir()
    res = asyncio.run(IndasTransformationPipeline().initiate(str(_filled(tmp_path)), str(out)))
    assert res["success"], res
    summary = res["summary"]
    assert summary["source"] == "standard_template"
    bs = summary["sheets"]["CANONICAL_BS"]
    assert bs[0]["Line_Item"] == "Property, plant and equipment"
    assert bs[0]["Current_Year_Amount"] == 1500000
    assert summary["sheets"]["CANONICAL_PL"][0]["Previous_Year_Amount"] is None  # NaN -> None (JSON-safe)
    assert load_workbook(out).sheetnames == list(CANONICAL_SCHEMA)


def test_pickles_with_a_foreign_os_path_load_here(tmp_path):
    # db/*.pkl is built on Linux; a PosixPath inside must still load on Windows (and vice versa).
    foreign = "WindowsPath" if isinstance(pathlib.Path(), pathlib.PosixPath) else "PosixPath"
    # protocol 0 names classes as plain text lines, so the class name can be swapped without breaking lengths
    data = pickle.dumps({"p": pathlib.Path("db/x.pkl")}, protocol=0).replace(type(pathlib.Path()).__name__.encode(), foreign.encode())
    f = tmp_path / "x.pkl"
    f.write_bytes(data)
    obj = asyncio.run(load_object(f))
    assert pathlib.Path(obj["p"]).name == "x.pkl"
