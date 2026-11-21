"""docs/15 §3 ELR scoping, the AI pick's guard rails, and the generator's cash flow / changes in equity (docs/17)."""
import json

import pytest

from src.constants import INDAS_OUTPUT_JSON_PATH
from src.pipeline.xml_generation_pipeline import IndASValidator, XbrlXmlGenerator
from src.services.sheet_scope import axis_members, scope_concepts, sheet_elrs
from src.services.tagging.llm_picker import Pick, Picks, render, valid_picks
from src.services.tagging.scoped_ranker import fuse


@pytest.fixture(scope="module")
def kb():
    with open(INDAS_OUTPUT_JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- scope
def test_each_statement_sheet_searches_only_its_own_elr(kb):
    bs = scope_concepts(kb, "CANONICAL_BS")
    assert {"ind-as:OtherEquity", "ind-as:Assets", "ind-as:BorrowingsCurrent", "ind-as:Inventories"} <= set(bs)
    assert "ind-as:RevenueFromOperations" not in bs  # a P&L concept is not a Balance Sheet candidate
    assert len(bs) < 100  # doc 15: tens of concepts, not 5,647
    assert "ind-as:RevenueFromOperations" in scope_concepts(kb, "CANONICAL_PL")
    assert "ind-as:CashAndCashEquivalentsCashFlowStatement" in scope_concepts(kb, "CANONICAL_CF")


def test_scope_has_no_abstract_or_text_concepts(kb):
    for q in scope_concepts(kb, "CANONICAL_PL"):
        c = kb["concepts"][q]
        assert not c.get("abstract") and c.get("type") not in ("textBlockItemType", "stringItemType")
        assert not q.endswith(("Abstract", "Axis", "Member", "Table"))


def test_notes_use_the_note_elrs_not_the_statements(kb):
    elrs = sheet_elrs(kb, "CANONICAL_FINANCIAL_NOTES")
    assert "110000" not in elrs and "210000" not in elrs and "400100" in elrs


def test_table_sheets_offer_their_axis_members(kb):
    assert "ind-as:RetainedEarningsMember" in axis_members(kb, "CANONICAL_SOCIE")
    ppe = axis_members(kb, "CANONICAL_PPE_SCHEDULE")
    assert ppe[0] == "ind-as:PropertyPlantAndEquipmentMember"
    assert {"ind-as:BuildingsMember", "ind-as:VehiclesMember"} <= set(ppe)


def test_unknown_sheet_is_refused(kb):
    with pytest.raises(ValueError):
        sheet_elrs(kb, "CANONICAL_NOPE")


def test_rank_fusion_rewards_agreement():
    assert fuse([3, 1, 2], [1, 3, 2])[:2] in ([3, 1], [1, 3])
    assert fuse([5, 6], [6, 7])[0] == 6


# ---------------------------------------------------------------- AI pick guard rails
def test_ai_pick_must_be_an_allowed_concept():
    shared = [("ind-as:OtherEquity", "Other equity"), ("ind-as:Assets", "Assets")]
    lines = [{"id": 0, "item": "Reserves and surplus"}, {"id": 1, "item": "Total assets"}, {"id": 2, "item": "x"}]
    res = Picks(picks=[Pick(id=0, qname="ind-as:OtherEquity"), Pick(id=1, qname="ind-as:Invented"), Pick(id=2, qname=None)])
    assert valid_picks(res, lines, shared) == {0: "ind-as:OtherEquity"}


def test_per_line_candidates_are_checked_per_line():
    lines = [{"id": 0, "item": "a", "candidates": [("q:A", "A")]}, {"id": 1, "item": "b", "candidates": [("q:B", "B")]}]
    assert valid_picks(Picks(picks=[Pick(id=0, qname="q:B"), Pick(id=1, qname="q:B")]), lines, None) == {1: "q:B"}


def test_prompt_sends_names_and_headings_only():
    body = render([{"id": 0, "item": "Reserves and surplus", "context": "EQUITY AND LIABILITIES > Equity"}], [("ind-as:OtherEquity", "Other equity")])
    assert "Reserves and surplus" in body and "EQUITY AND LIABILITIES > Equity" in body and "ind-as:OtherEquity" in body


# ---------------------------------------------------------------- generator: cash flow + changes in equity
def _payload(**over):
    p = {
        "meta": {"startDate": "2025-04-01", "endDate": "2026-03-31"},
        "master": {"company": {}, "auditor": {}, "signatories": []},
        "statements": {
            "balanceSheet": [{"concept": "ind-as:Inventories", "cy": 100, "py": 90}],
            "profitLoss": [{"concept": "ind-as:RevenueFromOperations", "cy": 500, "py": 400}],
            "cashFlow": [
                {"concept": "ind-as:CashAndCashEquivalentsCashFlowStatement", "cy": 10, "py": 8, "periodRole": "start"},
                {"concept": "ind-as:CashAndCashEquivalentsCashFlowStatement", "cy": 12, "py": 10},
                {"concept": "ind-as:NetCashFlowsFromUsedInOperatingActivities", "cy": 30, "py": 20},
            ],
        },
        "tables": [{
            "table": "ind-as:StatementOfChangesInEquityTable",
            "axis": "ind-as:ComponentsOfEquityAxis",
            "rows": [
                {"member": "ind-as:RetainedEarningsMember", "concept": "ind-as:ProfitLossForPeriod", "cy": 50, "py": 40},
                {"member": "ind-as:RetainedEarningsMember", "concept": "ind-as:EquityAttributableToOwnersOfParent", "cy": 200, "py": 150, "periodRole": "start"},
            ],
        }],
    }
    p.update(over)
    return p


@pytest.fixture(scope="module")
def concepts(kb):
    return kb["concepts"]


def test_cash_flow_uses_each_concepts_period_and_opening_dates(concepts):
    x = XbrlXmlGenerator(_payload(), concepts).build()
    assert '<ind-as:NetCashFlowsFromUsedInOperatingActivities contextRef="CY_Duration"' in x
    assert '<ind-as:CashAndCashEquivalentsCashFlowStatement contextRef="CY_Instant" unitRef="INR" decimals="0">12<' in x
    assert '<ind-as:CashAndCashEquivalentsCashFlowStatement contextRef="PY2_Instant" unitRef="INR" decimals="0">8<' in x
    # CY opening (10) and PY closing (10) are one fact: written once
    assert x.count('<ind-as:CashAndCashEquivalentsCashFlowStatement contextRef="PY_Instant"') == 1
    assert '<xbrli:context id="PY2_Instant">' in x and "<xbrli:instant>2024-03-31</xbrli:instant>" in x


def test_balance_sheet_and_pl_are_unchanged(concepts):
    x = XbrlXmlGenerator(_payload(), concepts).build()
    assert '<ind-as:Inventories contextRef="CY_Instant" unitRef="INR" decimals="0">100<' in x
    assert '<ind-as:RevenueFromOperations contextRef="PY_Duration" unitRef="INR" decimals="0">400<' in x


def test_changes_in_equity_are_dimensional_facts(concepts):
    x = XbrlXmlGenerator(_payload(), concepts).build()
    assert '<ind-as:ProfitLossForPeriod contextRef="CY_Duration_RetainedEarningsMember"' in x
    assert '<ind-as:EquityAttributableToOwnersOfParent contextRef="I20250331_RetainedEarningsMember" unitRef="INR" decimals="0">200<' in x
    assert 'dimension="ind-as:ComponentsOfEquityAxis">ind-as:RetainedEarningsMember<' in x
    assert x.count('<xbrli:context id="CY_Duration_RetainedEarningsMember">') == 1


def test_validator_flags_an_opening_balance_that_differs_from_the_prior_closing():
    payload = _payload()
    payload["statements"]["cashFlow"][0]["cy"] = 11  # CY opening 11, but PY closing says 10
    _, errors = IndASValidator(INDAS_OUTPUT_JSON_PATH).validate(payload)
    assert any(e["type"] == "OPENING_CLOSING_MISMATCH" for e in errors)
    _, ok_errors = IndASValidator(INDAS_OUTPUT_JSON_PATH).validate(_payload())
    assert not any(e["type"] == "OPENING_CLOSING_MISMATCH" for e in ok_errors)
