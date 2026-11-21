from pydantic import BaseModel, Field
from typing import Literal, Any, Optional

class RecommendSchema(BaseModel):
    keys: list[str]
    filter: Optional[dict] = None
    top_k: int = 3
    # docs/15 §3 ELR scoping: a canonical sheet name (CANONICAL_BS, ...); None = whole taxonomy
    scope: Optional[str] = None
    # "member" = suggest members of the sheet's table axis (SOCIE components, PPE classes)
    kind: Literal["concept", "member"] = "concept"
    # each key's headings (breadcrumb), shown to the LLM
    contexts: Optional[list[str]] = None
    # let the LLM pick among each line's best scoped candidates (line names + headings only are sent)
    use_llm: bool = False


class CheckSchema(BaseModel):
    """Tagged lines for the live Difference check: [{concept, cy, py, periodRole?}]."""
    rows: list[dict[str, Any]] = []


class Meta(BaseModel):
    taxonomy: str = "ind_as"
    nature: Literal["Standalone", "Consolidated"] = "Standalone"
    startDate: str = "2025-04-01"
    endDate: str = "2026-03-31"
    unit: Literal["INR", "USD"] = "INR"
    decimals: str = "0"


class Signatories(BaseModel):
    din: str
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    name: Optional[str] = None
    designation: str = "Director"
    signingDate: Optional[str] = None


class Master(BaseModel):
    company: dict[str, Any]
    auditor: dict[str, Any]
    signatories: list[Signatories]


class Statements(BaseModel):
    # each row: {concept, cy, py, periodRole?}; periodRole "start" = an opening balance (instant concepts only)
    balanceSheet: list[dict[str, Any]] = []
    profitLoss: list[dict[str, Any]] = []
    cashFlow: list[dict[str, Any]] = []
    # numeric lines of the notes (CANONICAL_FINANCIAL_NOTES), tagged against the note ELRs
    noteLines: list[dict[str, Any]] = []


class Table(BaseModel):
    table: str
    axis: str
    rows: list[dict[str, Any]]


class Note(BaseModel):
    concept: str
    content: str


class GenerateXML(BaseModel):
    meta: Meta
    master: Master
    statements: Statements
    tables: list[Table] = []
    notes: list[Note] = []
    unique_id: Optional[str] = None
