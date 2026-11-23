import html
import json
import os
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from src.constants import BASE_DIR, INDAS_OUTPUT_JSON_PATH, OUTPUT_DIR
from src.core.logger import logger
from src.services.statement_lines import merge_lines
from src.utils.main_utils import save_xml

from .base import Pipeline

# XBRL item type -> (unit id, decimals). Anything else numeric is an amount in rupees.
NUMERIC_UNITS: dict[str, tuple[str, int]] = {
    "perShareItemType": ("INR_per_share", 2),
    "sharesItemType": ("shares", 0),
    "pureItemType": ("pure", 2),
    "decimalItemType": ("pure", 2),
    "percentItemType": ("pure", 2),
}


class IndASValidator:
    """Production Validator executing statutory MCA rules directly from ind_as_knowledge_base.json.
    
    ZERO HARDCODING:
    - No hardcoded concept lists
    - No hardcoded exempt_negative set
    - Mandatory fields, non-negative concepts, and calculation trees are 100% dynamic.
    """

    def __init__(self, kb_path: Path | str):
        """Accepts path to the Knowledge Base JSON and extracts all statutory rules dynamically."""
        self.kb_path = Path(kb_path)
        if not self.kb_path.exists():
            raise FileNotFoundError(f"Knowledge Base JSON not found at: {self.kb_path}")

        with open(self.kb_path, "r", encoding="utf-8") as f:
            self.kb = json.load(f)

        self.concepts = self.kb.get("concepts", {})
        self.calculation = self.kb.get("calculation", {})
        self.business_rules = self.kb.get("businessRules", {})

        # Dynamically extracted from KB - NO HARDCODING
        self.mandatory_concepts = set(self.business_rules.get("mandatoryConcepts", []))
        self.mandatory_by_elr = self.business_rules.get("mandatoryByELR", {})
        self.non_negative_concepts = set(self.business_rules.get("nonNegativeConcepts", []))
        logger.info(
            "xml_validator.initialized",
            concepts=len(self.concepts),
            mandatory=len(self.mandatory_concepts),
            non_negative=len(self.non_negative_concepts),
        )

    def validate(self, payload: dict[str, Any]) -> tuple[bool, list[dict[str, Any]]]:
        """Validates filing payload dynamically against KB rules. Returns (is_valid, errors)."""
        errors = []

        # -------------------------------------------------------------
        # 1. Flatten Facts (CY & PY)
        # -------------------------------------------------------------
        facts_cy: dict[str, Any] = {}
        facts_py: dict[str, Any] = {}

        # Master Company & Auditor facts
        for k, v in payload.get("master", {}).get("company", {}).items():
            facts_cy[k] = v
        for k, v in payload.get("master", {}).get("auditor", {}).items():
            facts_cy[k] = v

        # Statement line items (Pure concept, cy, py - NO noteNo needed)
        statements = payload.get("statements", {})
        for rows in statements.values():
            for row in rows:
                concept = row.get("concept")
                if not concept or row.get("periodRole") == "start":
                    continue
                if "cy" in row and row["cy"] is not None:
                    facts_cy[concept] = row["cy"]
                if "py" in row and row["py"] is not None:
                    facts_py[concept] = row["py"]

        # The same fact twice with different amounts: an opening balance (periodRole "start") is the instant
        # one year earlier, so the CY opening must equal the PY closing of the same concept.
        seen_at: dict[tuple, Any] = {}
        for rows in statements.values():
            for row in rows:
                concept = row.get("concept")
                if not concept:
                    continue
                start = row.get("periodRole") == "start"
                for year, when in (("cy", "PY_END" if start else "CY_END"), ("py", "PY2_END" if start else "PY_END")):
                    v = row.get(year)
                    if v is None:
                        continue
                    key = (concept, when)
                    if key in seen_at and seen_at[key] != v:
                        errors.append({
                            "level": "ERROR",
                            "type": "DUPLICATE_FACT_CONFLICT",
                            "concept": concept,
                            "message": f"{concept} is reported twice for the same {'year' if when.endswith('END') and not start else 'date'} "
                                       f"with different amounts ({seen_at[key]:,} and {v:,}) — e.g. a line in two statements, "
                                       "or an opening balance that differs from the previous year's closing. Re-tag one of them.",
                        })
                    seen_at.setdefault(key, v)

        # Notes facts (text blocks)
        for note in payload.get("notes", []):
            concept = note.get("concept")
            if concept and note.get("content"):
                facts_cy[concept] = note["content"]

        # -------------------------------------------------------------
        # 2. Gate 1: Dynamic Mandatory Company Information (ELR 700300)
        # -------------------------------------------------------------
        company_mandatory = self.mandatory_by_elr.get("700300", [])
        for qn in company_mandatory:
            if qn not in facts_cy or not str(facts_cy[qn]).strip():
                concept_name = self.concepts.get(qn, {}).get("name", qn)
                errors.append({
                    "level": "ERROR",
                    "type": "MANDATORY_COMPANY_INFO_MISSING",
                    "concept": qn,
                    "message": f"Mandatory company identification field missing: {concept_name} ({qn})"
                })

        # -------------------------------------------------------------
        # 3. Gate 2: Statutory Signatories & Auditor Checks
        # -------------------------------------------------------------
        # Minimum 2 Director signatories required under Section 134(1) of Companies Act
        signatories = payload.get("master", {}).get("signatories", [])
        if len(signatories) < 2:
            errors.append({
                "level": "ERROR",
                "type": "INSUFFICIENT_SIGNATORIES",
                "message": f"Minimum 2 Director signatories required for AOC-4. Found: {len(signatories)}"
            })
        for idx, d in enumerate(signatories, 1):
            din = str(d.get("din", "")).strip()
            if not din or len(din) != 8 or not din.isdigit():
                errors.append({
                    "level": "ERROR",
                    "type": "INVALID_DIN",
                    "message": f"Signatory {idx}: Invalid 8-digit DIN ({d.get('din')})"
                })

        # -------------------------------------------------------------
        # 4. Gate 3: Dynamic Mandatory Statement Roots Check
        # -------------------------------------------------------------
        # Automatically discover the root concepts of statement calculation trees
        for elr in ["110000", "210000"]:
            eqs = self.calculation.get(elr, [])
            if eqs:
                parents = {eq["from"] for eq in eqs}
                children = {eq["to"] for eq in eqs}
                roots = parents - children
                for root_qn in roots:
                    # Ignore per-share metrics from fatal root check
                    if "earningslosspershare" in root_qn.lower():
                        continue
                    if root_qn not in facts_cy:
                        root_name = self.concepts.get(root_qn, {}).get("name", root_qn)
                        errors.append({
                            "level": "ERROR",
                            "type": "MANDATORY_STATEMENT_ROOT_MISSING",
                            "elr": elr,
                            "concept": root_qn,
                            "message": f"Mandatory financial statement root missing for ELR {elr}: {root_name} ({root_qn})"
                        })

        # -------------------------------------------------------------
        # 5. Gate 4: Dynamic Calculation & Math Summation Integrity
        # -------------------------------------------------------------
        # Evaluates sum(child * weight) == parent across all 37 calculation ELRs
        for elr, equations in self.calculation.items():
            parents: dict[str, list[dict[str, Any]]] = {}
            for eq in equations:
                parents.setdefault(eq["from"], []).append(eq)

            for parent_qname, children in parents.items():
                if parent_qname in facts_cy and isinstance(facts_cy[parent_qname], (int, float)):
                    expected = facts_cy[parent_qname]
                    present_children = [
                        ch for ch in children 
                        if ch["to"] in facts_cy and isinstance(facts_cy[ch["to"]], (int, float))
                    ]
                    if present_children:
                        calc_sum = sum(facts_cy[ch["to"]] * ch["weight"] for ch in present_children)
                        diff = round(expected - calc_sum, 2)
                        if abs(diff) > 1.0:  # MCA 1 INR rounding tolerance
                            parent_lbl = self.concepts.get(parent_qname, {}).get("name", parent_qname)
                            errors.append({
                                "level": "ERROR",
                                "type": "CALCULATION_MISMATCH",
                                "elr": elr,
                                "parent": parent_qname,
                                "expected": expected,
                                "calculated": calc_sum,
                                "diff": diff,
                                "message": f"Math mismatch in ELR {elr}: {parent_lbl} ({expected:,}) != sum of children ({calc_sum:,}) [Diff: {diff:,}]"
                            })

        # -------------------------------------------------------------
        # 6. Gate 5: Dynamic Balance Sheet Hard Balancing Check
        # -------------------------------------------------------------
        # Discovers debit and credit roots of ELR 110000 dynamically
        eqs_bs = self.calculation.get("110000", [])
        if eqs_bs:
            parents_bs = {eq["from"] for eq in eqs_bs}
            children_bs = {eq["to"] for eq in eqs_bs}
            roots_bs = parents_bs - children_bs
            debit_root = next(
                (r for r in roots_bs if self.concepts.get(r, {}).get("balance") == "debit" or "assets" in r.lower()), 
                None
            )
            credit_root = next(
                (r for r in roots_bs if self.concepts.get(r, {}).get("balance") == "credit" or "equity" in r.lower()), 
                None
            )
            if debit_root and credit_root and debit_root in facts_cy and credit_root in facts_cy:
                total_assets = facts_cy[debit_root]
                total_eq_liab = facts_cy[credit_root]
                bs_diff = round(total_assets - total_eq_liab, 2)
                if abs(bs_diff) > 1.0:
                    errors.append({
                        "level": "CRITICAL",
                        "type": "BS_OUT_OF_BALANCE",
                        "assets": total_assets,
                        "equityAndLiabilities": total_eq_liab,
                        "diff": bs_diff,
                        "message": f"Balance Sheet is out of balance! Total Assets ({total_assets:,}) != Total Equity and Liabilities ({total_eq_liab:,}) [Diff: {bs_diff:,}]"
                    })

        # -------------------------------------------------------------
        # 7. Gate 6: Dynamic Non-Negative Constraints (From MCA Rules)
        # -------------------------------------------------------------
        # Checked against all 211 concepts marked 'Should be greater than or equal to zero' in MCA rules
        # Zero hardcoded exempt_negative list needed!
        for qname, val in facts_cy.items():
            if qname in self.non_negative_concepts and isinstance(val, (int, float)) and val < 0:
                lbl = self.concepts.get(qname, {}).get("name", qname)
                errors.append({
                    "level": "ERROR",
                    "type": "NEGATIVE_VALUE_NOT_PERMITTED",
                    "concept": qname,
                    "value": val,
                    "message": f"MCA statutory rule violation: {lbl} ({qname}) cannot be negative (reported: {val:,})"
                })

        # -------------------------------------------------------------
        # 8. Gate 7: PPE 2D Multi-dimensional Table Schedule Reconciliations
        # -------------------------------------------------------------
        for table in payload.get("tables", []):
            if "PropertyPlantAndEquipment" in table.get("table", ""):
                for row in table.get("rows", []):
                    member = row.get("member", "Unknown")
                    # Gross Rollforward: Gross Opening + Additions - Disposals == Gross Closing
                    g_open = row.get("grossOpening", 0)
                    g_add = row.get("grossAdditions", 0)
                    g_disp = row.get("grossDisposals", 0)
                    g_close = row.get("grossClosing", 0)
                    if abs(g_open + g_add - g_disp - g_close) > 1.0:  # MCA 1 INR rounding tolerance
                        errors.append({
                            "level": "ERROR",
                            "type": "PPE_GROSS_ROLLFORWARD_MISMATCH",
                            "member": member,
                            "message": f"PPE Rollforward error for {member}: Gross Opening ({g_open:,}) + Additions ({g_add:,}) - Disposals ({g_disp:,}) != Closing ({g_close:,})"
                        })

                    # Dep Rollforward: Dep Opening + For Year - Disposals == Dep Closing
                    d_open = row.get("depOpening", 0)
                    d_year = row.get("depForYear", 0)
                    d_disp = row.get("depDisposals", 0)
                    d_close = row.get("depClosing", 0)
                    if abs(d_open + d_year - d_disp - d_close) > 1.0:
                        errors.append({
                            "level": "ERROR",
                            "type": "PPE_DEP_ROLLFORWARD_MISMATCH",
                            "member": member,
                            "message": f"PPE Depreciation error for {member}: Dep Opening ({d_open:,}) + For Year ({d_year:,}) - Disposals ({d_disp:,}) != Closing ({d_close:,})"
                        })

                    # Net Block: Net CY == Gross Closing - Dep Closing
                    net_cy = row.get("netCurrentYear", 0)
                    if abs(g_close - d_close - net_cy) > 1.0:
                        errors.append({
                            "level": "ERROR",
                            "type": "PPE_NET_BLOCK_MISMATCH",
                            "member": member,
                            "message": f"PPE Net Block error for {member}: Gross Closing ({g_close:,}) - Dep Closing ({d_close:,}) != Net CY ({net_cy:,})"
                        })

        is_valid = len([e for e in errors if e["level"] in ("ERROR", "CRITICAL")]) == 0
        if is_valid:
            logger.info("xml_validator.validation_passed", facts_cy=len(facts_cy), facts_py=len(facts_py))
        else:
            logger.warning("xml_validator.validation_failed", error_count=len(errors))
        return is_valid, errors


class XbrlXmlGenerator:
    """Compiles validated JSON payload into standard MCA AOC-4 XBRL instance document."""

    def __init__(self, payload: dict[str, Any], concepts: dict[str, Any] | None = None, taxonomy: dict[str, Any] | None = None):
        self.payload = payload
        # concept -> KB entry; its periodType decides instant vs duration contexts, its type the unit
        self.concepts = concepts or {}
        # the KB's meta: the entry point (schemaRef) and the namespace of every taxonomy prefix
        self.taxonomy = taxonomy or {}
        self.meta = payload.get("meta", {})
        self.master = payload.get("master", {})
        self.statements = payload.get("statements", {})
        self.tables = payload.get("tables", {})
        self.notes = payload.get("notes", [])
        self.cin = self.master.get("company", {}).get("in-ca:CorporateIdentityNumber", "UNKNOWN_CIN")
        self.start_date = self.meta.get("startDate", "2025-04-01")
        self.end_date = self.meta.get("endDate", "2026-03-31")
        # Prior year dates
        s_year = int(self.start_date.split("-")[0]) - 1
        e_year = int(self.end_date.split("-")[0]) - 1
        self.py_start_date = f"{s_year}-04-01"
        self.py_end_date = f"{e_year}-03-31"
        # an opening balance of the PY is the instant one year earlier
        self.py2_end_date = f"{e_year - 1}-03-31"

    def _period_type(self, concept: str, default: str) -> str:
        return (self.concepts.get(concept) or {}).get("periodType") or default

    def _numeric_fact(self, concept: str, ctx: str, value: Any) -> str:
        """One numeric fact with the unit and decimals its item type needs (per-share amounts in INR/share to 2 places)."""
        unit, places = NUMERIC_UNITS.get((self.concepts.get(concept) or {}).get("type"), ("INR", 0))
        amount = Decimal(str(value)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
        return f'  <{concept} contextRef="{ctx}" unitRef="{unit}" decimals="{places}">{amount}</{concept}>'

    @property
    def _cy_duration(self) -> str:
        return f"<xbrli:startDate>{self.start_date}</xbrli:startDate><xbrli:endDate>{self.end_date}</xbrli:endDate>"

    def _context(self, ctx_id: str, period: str, members: str) -> list[str]:
        """A dimensional context. The dimensions go where the taxonomy's hypercubes expect them
        (xbrldt:contextElement; Ind AS 2017: scenario, after the period)."""
        where = self.taxonomy.get("dimensionContextElement") or "scenario"
        identifier = f'<xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier>'
        segment = f"<xbrli:segment>{members}</xbrli:segment>" if where == "segment" else ""
        scenario = f"<xbrli:scenario>{members}</xbrli:scenario>" if where == "scenario" else ""
        return [
            f'  <xbrli:context id="{ctx_id}">',
            f"    <xbrli:entity>{identifier}{segment}</xbrli:entity>",
            f"    <xbrli:period>{period}</xbrli:period>",
            *([f"    {scenario}"] if scenario else []),
            "  </xbrli:context>",
        ]

    def _typed_domain(self, axis: str) -> str:
        """The element a typed axis's member value is written in (the axis's xbrldt:typedDomainRef)."""
        return (self.concepts.get(axis) or {}).get("typedDomain") or axis

    def _statement_contexts(self, concept: str, role: str | None, default: str) -> tuple[str, str]:
        """(CY, PY) context ids: duration -> the years; instant -> their ends, or their starts for an opening balance."""
        if self._period_type(concept, default) == "duration":
            return "CY_Duration", "PY_Duration"
        if role == "start":
            return "PY_Instant", "PY2_Instant"  # the CY starts where the PY ends
        return "CY_Instant", "PY_Instant"

    def _dimensional_context_id(self, axis: str, member: str, concept: str, role: str | None, year: str) -> tuple[str, str]:
        """(context id, xbrli:period inner XML) for one table fact."""
        m = member.split(":")[-1]
        if self._period_type(concept, "duration") == "duration":
            start, end = (self.start_date, self.end_date) if year == "cy" else (self.py_start_date, self.py_end_date)
            return f"{year.upper()}_Duration_{m}", f"<xbrli:startDate>{start}</xbrli:startDate><xbrli:endDate>{end}</xbrli:endDate>"
        ends = {"cy": self.end_date, "py": self.py_end_date}
        starts = {"cy": self.py_end_date, "py": self.py2_end_date}
        instant = starts[year] if role == "start" else ends[year]
        return f"I{instant.replace('-', '')}_{m}", f"<xbrli:instant>{instant}</xbrli:instant>"

    def _dimensional_contexts(self) -> list[tuple[str, str, str, str]]:
        """Unique (id, axis, member, period) for every generic table fact."""
        seen: dict[str, tuple[str, str, str, str]] = {}
        for tbl in self.payload.get("tables", []):
            axis = tbl.get("axis", "")
            for row in tbl.get("rows", []):
                if "concept" not in row or not row.get("member"):
                    continue
                for year in ("cy", "py"):
                    if row.get(year) is not None:
                        ctx_id, period = self._dimensional_context_id(axis, row["member"], row["concept"], row.get("periodRole"), year)
                        seen.setdefault(ctx_id, (ctx_id, axis, row["member"], period))
        return list(seen.values())

    def build(self) -> str:
        with logger.span("xbrl_generator.build", cin=self.cin):
            result = self._build_xml()
            logger.info("xbrl_generator.xml_assembled", length=len(result), cin=self.cin)
            return result

    def _build_xml(self) -> str:
        xml = []
        xml.append('<?xml version="1.0" encoding="UTF-8"?>')
        xml.append('<xbrli:xbrl')
        for prefix, ns in (self.taxonomy.get("namespaces") or {}).items():
            xml.append(f'  xmlns:{prefix}="{ns}"')
        xml.append('  xmlns:xbrli="http://www.xbrl.org/2003/instance"')
        xml.append('  xmlns:xlink="http://www.w3.org/1999/xlink"')
        xml.append('  xmlns:link="http://www.xbrl.org/2003/linkbase"')
        xml.append('  xmlns:xbrldi="http://xbrl.org/2006/xbrldi"')
        xml.append('  xmlns:iso4217="http://www.xbrl.org/2003/iso4217">')
        xml.append(f'  <link:schemaRef xlink:type="simple" xlink:href="{self.taxonomy.get("schemaRef", "")}"/>')
        xml.append('')

        # 1. Standard Contexts
        xml.append('  <!-- 1. STANDARD CONTEXTS -->')
        xml.append('  <xbrli:context id="CY_Instant">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:instant>{self.end_date}</xbrli:instant></xbrli:period>')
        xml.append('  </xbrli:context>')

        xml.append('  <xbrli:context id="PY_Instant">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:instant>{self.py_end_date}</xbrli:instant></xbrli:period>')
        xml.append('  </xbrli:context>')

        xml.append('  <xbrli:context id="PY2_Instant">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:instant>{self.py2_end_date}</xbrli:instant></xbrli:period>')
        xml.append('  </xbrli:context>')
        xml.append('')

        xml.append('  <xbrli:context id="CY_Duration">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:startDate>{self.start_date}</xbrli:startDate><xbrli:endDate>{self.end_date}</xbrli:endDate></xbrli:period>')
        xml.append('  </xbrli:context>')

        xml.append('  <xbrli:context id="PY_Duration">')
        xml.append(f'    <xbrli:entity><xbrli:identifier scheme="http://www.mca.gov.in/CIN">{self.cin}</xbrli:identifier></xbrli:entity>')
        xml.append(f'    <xbrli:period><xbrli:startDate>{self.py_start_date}</xbrli:startDate><xbrli:endDate>{self.py_end_date}</xbrli:endDate></xbrli:period>')
        xml.append('  </xbrli:context>')
        xml.append('')

        # 2. PPE Dimensional Contexts
        xml.append('  <!-- 2. PPE DIMENSIONAL CONTEXTS -->')
        for tbl in self.payload.get("tables", []):
            axis = tbl.get("axis", "ind-as:ClassesOfPropertyPlantAndEquipmentAxis")
            for row in tbl.get("rows", []):
                if "concept" in row:
                    continue  # generic table row: contexts in section 2b
                member = row.get("member")
                clean_m = member.split(":")[-1]
                explicit = f'<xbrldi:explicitMember dimension="{axis}">{member}</xbrldi:explicitMember>'
                xml += self._context(f"CY_Duration_{clean_m}", self._cy_duration, explicit)
                xml += self._context(f"CY_Instant_{clean_m}", f"<xbrli:instant>{self.end_date}</xbrli:instant>", explicit)
        xml.append('')

        # 2b. Dimensional Contexts for generic tables (rows with a concept: changes in equity, ...)
        xml.append('  <!-- 2b. DIMENSIONAL CONTEXTS (GENERIC TABLES) -->')
        for ctx_id, axis, member, period in self._dimensional_contexts():
            xml += self._context(ctx_id, period, f'<xbrldi:explicitMember dimension="{axis}">{member}</xbrldi:explicitMember>')
        xml.append('')

        # 3. Director Signatories Contexts (a typed axis: the DIN is written in the axis's typed domain element)
        xml.append('  <!-- 3. DIRECTOR SIGNATORIES CONTEXTS -->')
        directors_axis = "in-ca:DirectorsSigningFinancialStatementsAxis"
        directors_domain = self._typed_domain(directors_axis)
        for d in self.master.get("signatories", []):
            din = d.get("din")
            typed = f'<xbrldi:typedMember dimension="{directors_axis}"><{directors_domain}>{din}</{directors_domain}></xbrldi:typedMember>'
            xml += self._context(f"Director_{din}", self._cy_duration, typed)
        xml.append('')

        # 4. Units
        xml.append('  <!-- 4. UNITS -->')
        xml.append('  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>')
        xml.append('  <xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>')
        xml.append('  <xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>')
        xml.append('  <xbrli:unit id="INR_per_share"><xbrli:divide>'
                   '<xbrli:unitNumerator><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unitNumerator>'
                   '<xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator>'
                   '</xbrli:divide></xbrli:unit>')
        xml.append('')

        # 5. Master Facts (Escaped)
        xml.append('  <!-- 5. MASTER FACTS -->')
        for k, v in self.master.get("company", {}).items():
            xml.append(f'  <{k} contextRef="CY_Duration">{html.escape(str(v))}</{k}>')
        for k, v in self.master.get("auditor", {}).items():
            xml.append(f'  <{k} contextRef="CY_Duration">{html.escape(str(v))}</{k}>')
        for d in self.master.get("signatories", []):
            din = str(d.get("din", "")).strip()
            ctx = f"Director_{din}"
            first_name = d.get("firstName")
            last_name = d.get("lastName")
            if not first_name and "name" in d:
                parts = str(d["name"]).strip().split()
                first_name = parts[0] if parts else "Director"
                last_name = " ".join(parts[1:]) if len(parts) > 1 else "."
            designation = d.get("designation", "Director")
            signing_date = d.get("signingDate") or self.master.get("company", {}).get("in-ca:DateOfBoardMeetingWhenFinalAccountsWereApproved", "2026-04-25")

            xml.append(f'  <in-ca:DirectorIdentificationNumberOfDirector contextRef="{ctx}">{din}</in-ca:DirectorIdentificationNumberOfDirector>')
            xml.append(f'  <in-ca:FirstNameOfDirector contextRef="{ctx}">{html.escape(str(first_name or ""))}</in-ca:FirstNameOfDirector>')
            xml.append(f'  <in-ca:LastNameOfDirector contextRef="{ctx}">{html.escape(str(last_name or ""))}</in-ca:LastNameOfDirector>')
            xml.append(f'  <in-ca:DesignationOfDirector contextRef="{ctx}">{html.escape(str(designation))}</in-ca:DesignationOfDirector>')
            xml.append(f'  <in-ca:DateOfSigningOfFinancialStatementsByDirector contextRef="{ctx}">{signing_date}</in-ca:DateOfSigningOfFinancialStatementsByDirector>')
        xml.append('')

        # 6-7. Statement Facts (Balance Sheet, Profit & Loss, Cash Flow)
        sections = (
            ("6. BALANCE SHEET FACTS", ("balanceSheet", "balance_sheet"), "instant"),
            ("7. PROFIT & LOSS FACTS", ("profitLoss", "profit_and_loss", "pnl"), "duration"),
            ("7b. CASH FLOW FACTS", ("cashFlow", "cash_flow"), "duration"),
            ("7c. NOTE FACTS", ("noteLines",), "instant"),
        )
        emitted: set[tuple[str, str]] = set()  # (concept, context): an opening balance can repeat the PY closing
        for title, keys, default_period in sections:
            xml.append(f'  <!-- {title} -->')
            rows = next((self.statements.get(k) for k in keys if self.statements.get(k)), []) or []
            for r in rows:
                c = r["concept"]
                cy_ctx, py_ctx = self._statement_contexts(c, r.get("periodRole"), default_period)
                for year, ctx in (("cy", cy_ctx), ("py", py_ctx)):
                    if r.get(year) is None or (c, ctx) in emitted:
                        continue
                    emitted.add((c, ctx))
                    xml.append(self._numeric_fact(c, ctx, r[year]))
            xml.append('')

        # 8. PPE Schedule Facts
        xml.append('  <!-- 8. PPE SCHEDULE FACTS -->')
        for tbl in self.payload.get("tables", []):
            for row in tbl.get("rows", []):
                if "concept" in row:
                    continue
                clean_m = row["member"].split(":")[-1]
                c_dur = f"CY_Duration_{clean_m}"
                c_inst = f"CY_Instant_{clean_m}"
                # no gross / accumulated-depreciation axis is written, so these facts are the class's carrying
                # amount (the axis default): the net block, and disposals net of their depreciation
                xml.append(self._numeric_fact("ind-as:PropertyPlantAndEquipment", c_inst, row["netCurrentYear"]))
                xml.append(self._numeric_fact("ind-as:AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment", c_dur, row["grossAdditions"]))
                xml.append(self._numeric_fact("ind-as:DisposalsPropertyPlantAndEquipment", c_dur, Decimal(str(row["grossDisposals"])) - Decimal(str(row["depDisposals"]))))
                xml.append(self._numeric_fact("ind-as:DepreciationPropertyPlantAndEquipment", c_dur, row["depForYear"]))
        xml.append('')

        # 8b. Generic table facts (changes in equity, ...): concept x member, contexts from the period type
        xml.append('  <!-- 8b. TABLE FACTS (GENERIC) -->')
        for tbl in self.payload.get("tables", []):
            axis = tbl.get("axis", "")
            for row in tbl.get("rows", []):
                if "concept" not in row or not row.get("member"):
                    continue
                c = row["concept"]
                for year in ("cy", "py"):
                    if row.get(year) is not None:
                        ctx_id = self._dimensional_context_id(axis, row["member"], c, row.get("periodRole"), year)[0]
                        xml.append(self._numeric_fact(c, ctx_id, row[year]))
        xml.append('')

        # 9. Notes TextBlock Facts (CDATA XHTML)
        xml.append('  <!-- 9. NARRATIVE NOTES EXPLANATORY FACTS -->')
        for note in self.notes:
            concept = note["concept"]
            text = note["content"]
            xml.append(f'  <{concept} contextRef="CY_Duration"><![CDATA[<p style="text-align:justify; font-family:Arial,sans-serif; font-size:10pt;">{text}</p>]]></{concept}>')
        xml.append('')

        xml.append('</xbrli:xbrl>')
        return chr(10).join(xml)


class XMLGenerationPipeline(Pipeline):
    def __init__(self, payload: dict[str, Any]):
        # one fact per concept per statement: same-concept lines are added (statement_lines.merge_lines)
        statements = payload.get("statements") or {}
        payload = {**payload, "statements": {k: merge_lines(v or []) for k, v in statements.items()}}
        self.payload = payload
        self.validator = IndASValidator(kb_path=INDAS_OUTPUT_JSON_PATH)
        self.generator = XbrlXmlGenerator(payload=payload, concepts=self.validator.concepts, taxonomy=self.validator.kb.get("meta"))

    async def initiate(self, unique_id: str) -> dict[str, Any]:
        with logger.span("pipeline.xml_generation", unique_id=unique_id):
            is_valid, errors = self.validator.validate(payload=self.payload)
            if not is_valid:
                logger.warning("pipeline.xml_generation.rejected", unique_id=unique_id, error_count=len(errors))
                return {"success": False, "errors": errors}

            xml_content = self.generator.build()
            output_base = BASE_DIR / OUTPUT_DIR
            file_name = "MCA_AOC4_XML.xml"
            file_path = output_base / unique_id / file_name
            file_path.parent.mkdir(parents=True, exist_ok=True)
            await save_xml(file_path=file_path, content=xml_content)

            file_size_kb = round(os.path.getsize(file_path) / 1024, 2)
            logger.info("pipeline.xml_generation.saved", file_path=str(file_path), file_size_kb=file_size_kb)
            return {
                "success": True,
                "unique_id": unique_id,
                "file_name": file_name,
                "file_path": str(file_path),
                "file_size_kb": file_size_kb,
                "xml_content": xml_content,
            }

