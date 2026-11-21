"""A valid Ind AS XML end to end, on the synthetic filing (tests/fixtures/synthetic_indas/filing.json).

The payload is what the app sends to /indas/generateXML once every line carries its correct tag
(ui/src/features/indas/model.ts buildGenerateInput). It must pass our MCA checks, and the XML must pass a real
XBRL processor (Arelle) against the official Ind AS 2017 taxonomy: XBRL 2.1, dimensions and calculations.
"""
from __future__ import annotations

import asyncio
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import pytest

from src.pipeline.xml_generation_pipeline import XMLGenerationPipeline
from src.transformation.template import is_standard_template, read_standard_template
from tests.fixtures.synthetic_indas.build_workbook import build_workbook
from tests.xbrl_conformance import arelle_available, check_instance

FIXTURE = Path(__file__).parent / "fixtures" / "synthetic_indas" / "filing.json"
STATEMENTS = {"CANONICAL_BS": "balanceSheet", "CANONICAL_PL": "profitLoss", "CANONICAL_CF": "cashFlow", "CANONICAL_FINANCIAL_NOTES": "noteLines"}
PPE_FIELDS = {
    "Gross_Opening": "grossOpening", "Gross_Additions": "grossAdditions", "Gross_Disposals": "grossDisposals", "Gross_Closing": "grossClosing",
    "Dep_Opening": "depOpening", "Dep_For_Year": "depForYear", "Dep_Disposals": "depDisposals", "Dep_Closing": "depClosing",
    "Net_Current_Year": "netCurrentYear", "Net_Previous_Year": "netPreviousYear",
}


def load_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def payload_from_fixture(f: dict[str, Any]) -> dict[str, Any]:
    """The /generateXML body the app builds when every line is tagged as the fixture says."""
    meta = f["meta"]
    company = {f"in-ca:{k}": v for k, v in f["company"].items()}
    company |= {"in-ca:DateOfStartOfReportingPeriod": meta["startDate"], "in-ca:DateOfEndOfReportingPeriod": meta["endDate"],
                "in-ca:NatureOfReportStandaloneConsolidated": meta["nature"]}
    statements = {
        key: [{"concept": r["concept"], "cy": r.get("cy"), "py": r.get("py"), "periodRole": r.get("periodRole", "end")}
              for r in f["sheets"][sheet] if r.get("concept")]
        for sheet, key in STATEMENTS.items()
    }
    ppe = [{"member": r["member"], **{field: abs(r["amounts"][col] or 0) if col.endswith("Disposals") else (r["amounts"][col] or 0)
                                      for col, field in PPE_FIELDS.items()}}
           for r in f["sheets"]["CANONICAL_PPE_SCHEDULE"]]
    return {
        "meta": meta,
        "master": {
            "company": company,
            "auditor": {"in-ca:DisclosureInAuditorsReportExplanatory": "Unmodified opinion.",
                        "in-ca:WhetherCompaniesAuditorsReportOrderIsApplicableOnCompany": "false",
                        "in-ca:WhetherAuditorsReportHasBeenQualifiedOrHasAnyReservationsOrContainsAdverseRemarks": "false"},
            "signatories": f["signatories"],
        },
        "statements": statements,
        "tables": [
            {"table": "ind-as:StatementOfChangesInEquityTable", "axis": "ind-as:ComponentsOfEquityAxis", "rows": []},
            {"table": "ind-as:PropertyPlantAndEquipmentTable", "axis": "ind-as:ClassesOfPropertyPlantAndEquipmentAxis", "rows": ppe},
        ],
        "notes": [{"concept": t["concept"], "content": t["content"]} for t in f["texts"]],
    }


@pytest.fixture(scope="module")
def generated() -> dict[str, Any]:
    pipeline = XMLGenerationPipeline(payload_from_fixture(load_fixture()))
    return asyncio.run(pipeline.initiate(unique_id="pytest-synthetic"))


def test_the_workbook_is_a_standard_template_with_every_line(tmp_path: Path) -> None:
    path = build_workbook(tmp_path / "synthetic.xlsx")
    assert is_standard_template(path)
    sheets = read_standard_template(path)
    f = load_fixture()
    for sheet, rows in f["sheets"].items():
        assert len(sheets[sheet]) == len(rows), sheet


def test_our_checks_pass(generated: dict[str, Any]) -> None:
    assert generated["success"], json.dumps(generated.get("errors"), indent=1)


def test_the_xml_uses_the_mca_ind_as_2017_entry_point_and_namespaces(generated: dict[str, Any]) -> None:
    root = ET.fromstring(generated["xml_content"].encode("utf-8"))
    ref = root.find("{http://www.xbrl.org/2003/linkbase}schemaRef")
    assert ref is not None and ref.get("{http://www.w3.org/1999/xlink}href") == "https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd"
    assert root.find("{http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as}EquityAndLiabilities") is not None
    assert root.find("{http://www.icai.org/xbrl/taxonomy/2017-03-31/in-ca}NameOfCompany") is not None


def test_eps_is_reported_per_share_with_its_decimals(generated: dict[str, Any]) -> None:
    root = ET.fromstring(generated["xml_content"].encode("utf-8"))
    eps = root.findall("{http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as}BasicEarningsLossPerShare")
    assert {e.text for e in eps} == {"5.00", "2.80"}
    unit = next(u for u in root.iter("{http://www.xbrl.org/2003/instance}unit") if u.get("id") == eps[0].get("unitRef"))
    assert unit.find("{http://www.xbrl.org/2003/instance}divide") is not None


def test_dimensions_go_in_the_scenario_and_the_din_in_the_typed_domain(generated: dict[str, Any]) -> None:
    xbrli, xbrldi = "{http://www.xbrl.org/2003/instance}", "{http://xbrl.org/2006/xbrldi}"
    root = ET.fromstring(generated["xml_content"].encode("utf-8"))
    contexts = {c.get("id"): c for c in root.iter(f"{xbrli}context")}
    assert not any(c.find(f"{xbrli}entity/{xbrli}segment") is not None for c in contexts.values())
    director = contexts["Director_01234567"].find(f"{xbrli}scenario/{xbrldi}typedMember")
    assert director[0].tag == "{http://www.icai.org/xbrl/taxonomy/2017-03-31/in-ca}DirectorsSigningFinancialStatementsDomain"
    assert contexts["CY_Instant_PlantAndEquipmentMember"].find(f"{xbrli}scenario/{xbrldi}explicitMember") is not None


def test_the_ppe_class_reports_its_carrying_amount(generated: dict[str, Any]) -> None:
    root = ET.fromstring(generated["xml_content"].encode("utf-8"))
    ppe = {e.get("contextRef"): e.text for e in root.iter("{http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as}PropertyPlantAndEquipment")}
    assert ppe["CY_Instant_PlantAndEquipmentMember"] == ppe["CY_Instant"] == "800000"


@pytest.mark.skipif(not arelle_available(), reason="Arelle (uv sync --extra dev) and the Ind AS taxonomy in data/ are needed")
def test_a_real_xbrl_processor_finds_no_problem(generated: dict[str, Any]) -> None:
    problems = check_instance(generated["xml_content"])
    assert problems == [], "\n".join(map(str, problems))
