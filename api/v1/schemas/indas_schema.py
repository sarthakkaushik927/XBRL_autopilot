from typing import Any, Literal

from pydantic import BaseModel, Field


class RecommendSchema(BaseModel):
    keys: list[str]
    filter: dict | None = None
    top_k: int = 3
    # docs/15 §3 ELR scoping: a canonical sheet name (CANONICAL_BS, ...); None = whole taxonomy
    scope: str | None = None
    # "member" = suggest members of the sheet's table axis (SOCIE components, PPE classes)
    kind: Literal["concept", "member"] = "concept"
    # each key's headings (breadcrumb), shown to the LLM
    contexts: list[str] | None = None
    # let the LLM pick among each line's best scoped candidates (line names + headings only are sent)
    use_llm: bool = False


class Meta(BaseModel):
    taxonomy: str = "ind_as"
    nature: Literal["Standalone", "Consolidated"] = "Standalone"
    startDate: str = "2025-04-01"
    endDate: str = "2026-03-31"
    unit: Literal["INR", "USD"] = "INR"
    decimals: str = "0"


class Signatories(BaseModel):
    din: str
    firstName: str | None = None
    lastName: str | None = None
    name: str | None = None
    designation: str = "Director"
    signingDate: str | None = None


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
    unique_id: str | None = None


# ---------------------------------------------------------------- Fix with AI (Problems panel)
class FixProblem(BaseModel):
    id: str = Field(max_length=200)
    message: str = Field(max_length=1000)
    concept: str = Field(max_length=300)
    elr: str | None = Field(default=None, max_length=40)
    year: Literal["CY", "PY"] | None = None
    statement: str | None = Field(default=None, max_length=40)


class FixLine(BaseModel):
    id: str = Field(max_length=300)
    statement: str = Field(max_length=40)
    # the canonical sheet (CANONICAL_BS, ...): its scope gives the allowed concepts
    sheet: str = Field(max_length=40)
    label: str = Field(max_length=500)
    headings: str = Field(default="", max_length=1000)
    cy: float | None = None
    py: float | None = None
    concept: str = Field(default="", max_length=300)
    periodRole: Literal["start", "end"] = "end"


class FixRequest(BaseModel):
    """The totals that don't add up and the lines of their statements (no company name, CIN or DINs)."""
    problems: list[FixProblem] = Field(min_length=1, max_length=50)
    lines: list[FixLine] = Field(min_length=1, max_length=600)
