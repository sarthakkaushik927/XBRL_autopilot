"""A bare "Total" on the balance sheet closes the section its lines add up to (transformation/indas.total_level).

HPL (2026-11-23): the "Equity and liabilities" grand total sits right after the current-liability lines and was given
the heading "Current liabilities > Total", so Auto-tag tagged it CurrentLiabilities and the balance sheet was out of
balance. Amounts here are made up.
"""
from src.transformation.indas import total_level

EL, CL, NCL, EQ = "EQUITY AND LIABILITIES", "Current liabilities", "Non-current liabilities", "Equity"


def line(path, cy, py=0.0, is_total=False):
    return {"path": path, "cy": cy, "py": py, "is_total": is_total}


LINES = [
    line([EL, EQ], 400, 300),
    line([EL, NCL], 100, 90),
    line([EL, CL], 250, 200),
    line([EL, CL], 50, 10),
]


def test_a_grand_total_after_the_last_section_closes_the_top_section():
    assert total_level(LINES, [EL, CL], 800, 600) == 1


def test_a_section_total_closes_that_section():
    assert total_level(LINES, [EL, CL], 300, 210) == 2


def test_other_totals_are_not_counted_twice():
    lines = [*LINES, line([EL, CL], 300, 210, is_total=True)]
    assert total_level(lines, [EL, CL], 800, 600) == 1


def test_rounding_to_whole_rupees_is_tolerated():
    assert total_level(LINES, [EL, CL], 801, 600) == 1


def test_a_total_that_adds_up_to_no_section_gives_none():
    # the workbook's own total is off (HPL's assets total is 1,000 more than its lines)
    assert total_level(LINES, [EL, CL], 1800, 2600) is None


def test_one_year_adding_up_is_enough():
    # HPL: the CY grand total adds up exactly, the workbook's PY total is 2,000 off its lines
    assert total_level(LINES, [EL, CL], 800, 2600) == 1
    assert total_level(LINES, [EL, CL], 9999, 600) == 1
    assert total_level(LINES, [EL, CL], 800, 0) == 1  # no PY amount: CY decides


def test_a_section_total_is_preferred_to_the_top_when_it_adds_up():
    assert total_level(LINES, [EL, CL], 300, 2600) == 2
