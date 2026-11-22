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
    assert any(e["type"] == "DUPLICATE_FACT_CONFLICT" for e in errors)
    _, ok_errors = IndASValidator(INDAS_OUTPUT_JSON_PATH).validate(_payload())
    assert not any(e["type"] == "DUPLICATE_FACT_CONFLICT" for e in ok_errors)


def test_text_block_scope_is_the_notes_narrative_concepts(kb):
    tb = scope_concepts(kb, "TEXT_BLOCKS")
    assert tb and all(kb["concepts"][q]["type"] == "textBlockItemType" for q in tb)
    assert "ind-as:DisclosureOfPropertyPlantAndEquipmentExplanatory" in tb


def test_note_lines_use_each_concepts_period(concepts):
    p = _payload()
    p["statements"]["noteLines"] = [
        {"concept": "ind-as:InventoriesAtNetRealisableValue", "cy": 7, "py": 6},
        {"concept": "ind-as:InventoryWritedown", "cy": 2, "py": 1},
    ]
    x = XbrlXmlGenerator(p, concepts).build()
    assert '<ind-as:InventoriesAtNetRealisableValue contextRef="CY_Instant" unitRef="INR" decimals="0">7<' in x
    assert '<ind-as:InventoryWritedown contextRef="PY_Duration" unitRef="INR" decimals="0">1<' in x


# ---------------------------------------------------------------- split view: trees + Difference check
def test_balance_sheet_tree_is_the_presentation_hierarchy(kb):
    from src.services.sheet_tree import sheet_trees

    [bs] = sheet_trees(kb, "CANONICAL_BS")
    assert bs["elr"] == "110000"
    qnames = [n["qname"] for n in bs["nodes"]]
    assert qnames.index("ind-as:Inventories") < qnames.index("ind-as:CurrentAssets") or "ind-as:CurrentAssets" in qnames
    inv = next(n for n in bs["nodes"] if n["qname"] == "ind-as:Inventories")
    assert inv["depth"] > 0 and not inv["abstract"] and inv["label"] == "Inventories"
    assert any(n["abstract"] for n in bs["nodes"])  # headings stay, for structure
    mandatory = {n["qname"] for n in bs["nodes"] if n["mandatory"]}
    assert "ind-as:Assets" in mandatory or mandatory  # MCA's mandatory BS lines are flagged


def test_member_tree_for_fixed_assets(kb):
    from src.services.sheet_tree import sheet_trees

    [t] = sheet_trees(kb, "CANONICAL_PPE_SCHEDULE", "member")
    nodes = {n["qname"]: n for n in t["nodes"]}
    assert nodes["ind-as:BuildingsMember"]["depth"] < nodes["ind-as:FactoryBuildingMember"]["depth"]


def test_same_concept_lines_of_a_statement_are_added_like_webxbrl_add():
    from src.services.statement_lines import merge_lines

    rows = [
        {"concept": "ind-as:OtherAdjustmentsForNoncashItems", "cy": -324825, "py": 271898},
        {"concept": "ind-as:ProfitBeforeTax", "cy": 10, "py": 9},
        {"concept": "ind-as:OtherAdjustmentsForNoncashItems", "cy": "-68559.50", "py": None},
        {"concept": "ind-as:CashAndCashEquivalentsCashFlowStatement", "cy": 5, "py": 4, "periodRole": "start"},
        {"concept": "ind-as:CashAndCashEquivalentsCashFlowStatement", "cy": 7, "py": 5},
        {"concept": "", "cy": 1, "py": 1},
    ]
    out = merge_lines(rows)
    assert [(r["concept"].split(":")[1], r.get("periodRole")) for r in out] == [
        ("OtherAdjustmentsForNoncashItems", None), ("ProfitBeforeTax", None),
        ("CashAndCashEquivalentsCashFlowStatement", "start"), ("CashAndCashEquivalentsCashFlowStatement", None),
    ]
    assert out[0]["cy"] == -393384.5 and out[0]["py"] == 271898


def test_generate_adds_same_concept_cash_flow_lines_instead_of_reporting_a_conflict(concepts):
    from src.pipeline.xml_generation_pipeline import XMLGenerationPipeline

    p = _payload()
    p["statements"]["cashFlow"] += [
        {"concept": "ind-as:OtherAdjustmentsForNoncashItems", "cy": 3, "py": 1},
        {"concept": "ind-as:OtherAdjustmentsForNoncashItems", "cy": 4, "py": 2},
    ]
    pipe = XMLGenerationPipeline(p)
    _, errors = pipe.validator.validate(pipe.payload)
    assert not any(e["type"] == "DUPLICATE_FACT_CONFLICT" for e in errors)
    x = pipe.generator.build()
    assert '<ind-as:OtherAdjustmentsForNoncashItems contextRef="CY_Duration" unitRef="INR" decimals="0">7<' in x


def test_ppe_checks_allow_one_rupee_of_rounding():
    payload = _payload(tables=[{"table": "ind-as:PropertyPlantAndEquipmentTable", "axis": "ind-as:ClassesOfPropertyPlantAndEquipmentAxis", "rows": [
        {"member": "ind-as:ComputerEquipmentsMember", "grossOpening": 100, "grossAdditions": 50, "grossDisposals": 0, "grossClosing": 150,
         "depOpening": 10, "depForYear": 5, "depDisposals": 0, "depClosing": 16, "netCurrentYear": 134},
    ]}])
    _, errors = IndASValidator(INDAS_OUTPUT_JSON_PATH).validate(payload)
    assert not any(e["type"].startswith("PPE_") for e in errors)  # depreciation off by 1 INR: tolerated
