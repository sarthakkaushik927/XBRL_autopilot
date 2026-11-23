"""Fix with AI for the Ind AS Problems panel: the KB context, the guard rails and the route (LLM mocked)."""
import json

import pytest

from src.constants import INDAS_OUTPUT_JSON_PATH
from src.services import indas_fix
from src.services.indas_fix import (
    FixAnswer,
    ProposedChange,
    allowed_concepts,
    equations,
    plan,
    relevant_lines,
    render,
    valid_changes,
)


@pytest.fixture(scope="module")
def kb():
    with open(INDAS_OUTPUT_JSON_PATH, encoding="utf-8") as f:
        return json.load(f)


PROBLEM = {
    "id": "balanceSheet:CY:ind-as:CurrentAssets",
    "message": "Balance Sheet · CY: Total current assets 1,90,000 ≠ 68,000 (difference 1,22,000)",
    "concept": "ind-as:CurrentAssets",
    "elr": "110000",
    "year": "CY",
    "statement": "balanceSheet",
}


def line(i, label, concept, cy, py=None, role="end"):
    return {"id": f"balanceSheet:{i}", "statement": "balanceSheet", "sheet": "CANONICAL_BS", "label": label,
            "headings": "Assets > Current assets", "cy": cy, "py": py, "concept": concept, "periodRole": role}


LINES = [
    line(1, "Inventories", "ind-as:Inventories", 50000),
    line(2, "Trade receivables", "ind-as:NoncurrentAssets", 122000),  # wrongly tagged non-current
    line(3, "Other current assets", "ind-as:OtherCurrentAssets", 18000),
    line(4, "Total current assets", "ind-as:CurrentAssets", 190000),
]


def answer(*changes):
    return FixAnswer(explanation="Trade receivables are tagged non-current.", changes=[ProposedChange(**c) for c in changes])


def test_equations_give_the_total_and_the_total_it_belongs_to(kb):
    eqs = dict(equations(kb, "ind-as:CurrentAssets", "110000"))
    assert ("ind-as:Inventories", 1.0) in eqs["ind-as:CurrentAssets"]
    assert ("ind-as:CurrentAssets", 1.0) in eqs["ind-as:Assets"]


def test_small_scopes_are_offered_whole_and_the_notes_by_neighbourhood(kb):
    allowed = allowed_concepts(kb, [PROBLEM], LINES)
    assert "ind-as:TradeReceivablesCurrent" in allowed and "ind-as:BorrowingsCurrent" in allowed  # the BS scope
    note = {**LINES[0], "sheet": "CANONICAL_FINANCIAL_NOTES"}
    notes_only = allowed_concepts(kb, [PROBLEM], [note])
    assert "ind-as:Inventories" in notes_only and len(notes_only) < 60  # not the 1,843 note concepts


def test_prompt_has_the_calculation_and_the_amounts_but_no_identity(kb):
    body = render(kb, [PROBLEM], LINES, allowed_concepts(kb, [PROBLEM], LINES))
    assert "calculation: ind-as:CurrentAssets (Total current assets) = + ind-as:Inventories" in body
    assert "balanceSheet:2 | Trade receivables | Assets > Current assets | 122000 | blank | ind-as:NoncurrentAssets" in body
    assert "CIN" not in body and "DIN" not in body


def test_a_retag_to_an_allowed_concept_survives(kb):
    allowed = allowed_concepts(kb, [PROBLEM], LINES)
    out = valid_changes(kb, answer({"problem_id": PROBLEM["id"], "line_id": "balanceSheet:2", "concept": "ind-as:TradeReceivablesCurrent", "reason": "Shown under current assets."}), [PROBLEM], LINES, allowed)
    assert out == [{"problemId": PROBLEM["id"], "rowId": "balanceSheet:2", "concept": "ind-as:TradeReceivablesCurrent",
                    "conceptLabel": "Trade receivables, current", "reason": "Shown under current assets."}]


def test_guard_rails_drop_unknown_lines_concepts_problems_and_no_ops(kb):
    allowed = allowed_concepts(kb, [PROBLEM], LINES)
    bad = answer(
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:99", "concept": "ind-as:Inventories", "reason": "x"},  # unknown line
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:1", "concept": "ind-as:RevenueFromOperations", "reason": "x"},  # not allowed
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:1", "concept": "ind-as:Inventories", "reason": "x"},  # no change
        {"problem_id": "miscopied", "line_id": "balanceSheet:3", "concept": None, "reason": "counted twice"},  # untag: kept
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:3", "concept": "ind-as:Inventories", "reason": "x"},  # same line twice
    )
    out = valid_changes(kb, bad, [PROBLEM], LINES, allowed)
    assert [(c["rowId"], c["concept"]) for c in out] == [("balanceSheet:3", "")]
    assert out[0]["problemId"] == PROBLEM["id"]  # a miscopied problem id falls back to the request's first problem


def test_opening_balance_only_for_an_instant_concept(kb):
    allowed = allowed_concepts(kb, [PROBLEM], LINES) + ["ind-as:RevenueFromOperations"]
    out = valid_changes(kb, answer(
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:1", "concept": "ind-as:Inventories", "period_role": "start", "reason": "opening stock"},
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:3", "concept": "ind-as:RevenueFromOperations", "period_role": "start", "reason": "x"},
    ), [PROBLEM], LINES, allowed)
    assert out[0]["periodRole"] == "start" and out[0]["rowId"] == "balanceSheet:1"
    assert "periodRole" not in out[1]  # a duration concept has no opening balance


def test_route_returns_the_checked_changes(client, monkeypatch):
    seen = {}

    async def fake(kb, problems, lines):
        seen.update(problems=problems, lines=lines)
        return {"explanation": "ok", "changes": []}

    monkeypatch.setattr("api.v1.routes.indas_router.propose_fix", fake)
    res = client.post("/api/v1/indas/fix", json={"problems": [PROBLEM], "lines": LINES})
    assert res.status_code == 200 and res.json()["data"] == {"explanation": "ok", "changes": []}
    assert seen["lines"][1]["cy"] == 122000


def test_route_says_when_the_ai_is_unreachable(client, monkeypatch):
    async def down(*_):
        raise RuntimeError("no key")

    monkeypatch.setattr("api.v1.routes.indas_router.propose_fix", down)
    res = client.post("/api/v1/indas/fix", json={"problems": [PROBLEM], "lines": LINES})
    assert res.status_code == 502 and "no key" in res.json()["message"]


def test_route_refuses_an_empty_request(client):
    assert client.post("/api/v1/indas/fix", json={"problems": [], "lines": LINES}).status_code == 422


def test_propose_fix_runs_the_llm_answer_through_the_guard_rails(kb, monkeypatch):
    class FakeChain:
        def __or__(self, other):
            return self

        async def ainvoke(self, inputs):
            assert "- Problem P1: " in inputs["body"]  # short ids in the prompt
            return answer({"problem_id": PROBLEM["id"], "line_id": "balanceSheet:2", "concept": "ind-as:TradeReceivablesCurrent", "reason": "current"},
                          {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:2", "concept": "ind-as:Nope", "reason": "x"})

    class FakeLlm:
        def with_structured_output(self, _):
            return FakeChain()

    monkeypatch.setattr(indas_fix, "get_llm", lambda: FakeLlm())
    monkeypatch.setattr(indas_fix, "PROMPT", FakeChain())
    import asyncio
    out = asyncio.run(indas_fix.propose_fix(kb, [PROBLEM], LINES))
    assert [c["concept"] for c in out["changes"]] == ["ind-as:TradeReceivablesCurrent"]
    assert out["changes"][0]["problemId"] == PROBLEM["id"]  # mapped back from P1


# ---------------------------------------------------------------- Fix all within the token limit
def note(i, label, concept, headings):
    return {"id": f"noteLines:{i}", "statement": "noteLines", "sheet": "CANONICAL_FINANCIAL_NOTES", "label": label,
            "headings": headings, "cy": 10, "py": None, "concept": concept, "periodRole": "end"}


NOTE_LINES = [note(i, f"Other line {i}", "ind-as:OtherExpenses", "Expenses > Other expenses") for i in range(70)] + [
    note(70, "Trade receivables", "ind-as:TradeReceivablesCurrent", "Current assets > Financial assets"),
    note(71, "Cash on hand", "ind-as:CashAndCashEquivalents", "Current assets > Financial assets > Cash"),
    note(72, "Loans to employees", "ind-as:OtherExpenses", "Current assets > Financial assets > Loans"),
]
INV = {"id": "n1", "message": "Notes · CY: Total current financial assets 30 ≠ 20", "concept": "ind-as:CurrentFinancialAssets", "elr": None, "year": "CY", "statement": "noteLines"}


def test_a_long_statement_sends_only_the_lines_around_the_problem(kb):
    picked = [ln["label"] for ln in relevant_lines(kb, INV, NOTE_LINES)]
    # the tagged parts of the total, and the line under the same headings that is tagged elsewhere
    assert picked == ["Trade receivables", "Cash on hand", "Loans to employees"]


def test_fix_all_is_split_by_statement_and_within_the_budget(kb, monkeypatch):
    chunks = plan(kb, [PROBLEM, INV], LINES + NOTE_LINES)
    assert [[p["id"] for p in ps] for ps, _ in chunks] == [[PROBLEM["id"]], ["n1"]]
    assert {ln["statement"] for ln in chunks[0][1]} == {"balanceSheet"} and len(chunks[1][1]) == 3
    monkeypatch.setattr(indas_fix, "PROMPT_BUDGET", 10)
    many = [{**PROBLEM, "id": f"p{i}"} for i in range(3)]
    assert [len(ps) for ps, _ in plan(kb, many, LINES)] == [1, 1, 1]  # each alone once the budget is exceeded


def _fake_llm(monkeypatch, answers):
    class FakeChain:
        def __or__(self, other):
            return self

        async def ainvoke(self, inputs):
            a = answers.pop(0)
            if isinstance(a, Exception):
                raise a
            return a

    class FakeLlm:
        def with_structured_output(self, _):
            return FakeChain()

    monkeypatch.setattr(indas_fix, "get_llm", lambda: FakeLlm())
    monkeypatch.setattr(indas_fix, "PROMPT", FakeChain())
    monkeypatch.setattr(indas_fix, "FIX_DEADLINE_S", 0)  # no waiting for a rate limit in tests


def test_a_part_that_hits_the_rate_limit_is_named_and_the_others_still_count(kb, monkeypatch):
    import asyncio
    good = answer({"problem_id": PROBLEM["id"], "line_id": "balanceSheet:2", "concept": "ind-as:TradeReceivablesCurrent", "reason": "current"})
    _fake_llm(monkeypatch, [good, RuntimeError("Error code: 413 - rate_limit_exceeded")])
    out = asyncio.run(indas_fix.propose_fix(kb, [PROBLEM, INV], LINES + NOTE_LINES))
    assert [c["rowId"] for c in out["changes"]] == ["balanceSheet:2"]
    assert out["explanation"].endswith("1 total(s) were not checked: the AI service's per-minute limit was reached, ask again in a minute.")


def test_every_part_failing_is_an_error(kb, monkeypatch):
    import asyncio
    _fake_llm(monkeypatch, [RuntimeError("429 rate_limit"), RuntimeError("429 rate_limit")])
    with pytest.raises(RuntimeError, match="per-minute limit"):
        asyncio.run(indas_fix.propose_fix(kb, [PROBLEM, INV], LINES + NOTE_LINES))


def test_a_malformed_answer_is_asked_once_more(kb, monkeypatch):
    import asyncio
    good = answer({"problem_id": "P1", "line_id": "balanceSheet:2", "concept": "ind-as:TradeReceivablesCurrent", "reason": "current"})
    _fake_llm(monkeypatch, [RuntimeError("Error code: 400 - tool_use_failed"), good])
    out = asyncio.run(indas_fix.propose_fix(kb, [PROBLEM], LINES))
    assert [c["rowId"] for c in out["changes"]] == ["balanceSheet:2"] and out["changes"][0]["problemId"] == PROBLEM["id"]


def test_cy_and_py_of_one_total_are_asked_as_one_problem():
    py = {**PROBLEM, "id": "balanceSheet:PY:x", "year": "PY", "message": "PY: 5 ≠ 3"}
    merged = indas_fix.merge_years([PROBLEM, py, INV])
    assert [p["id"] for p in merged] == [PROBLEM["id"], "n1"]
    assert merged[0]["message"].endswith("; PY: 5 ≠ 3")


def test_rate_limit_wait_is_read_from_groq_message():
    assert indas_fix._retry_after(RuntimeError("Please try again in 7.25s.")) == 7.25
    assert indas_fix._retry_after(RuntimeError("Please try again in 820ms.")) == 0.82
    assert indas_fix._retry_after(RuntimeError("Please try again in 1m2.5s.")) == 62.5
    assert indas_fix._retry_after(RuntimeError("429")) == 10.0


def test_a_part_is_never_retagged_as_its_own_total_unless_it_is_a_total_line(kb):
    lines = [line(1, "Equity share capital", "ind-as:EquityShareCapital", 100), line(2, "Total equity", "ind-as:EquityShareCapital", 300)]
    allowed = ["ind-as:Equity", "ind-as:EquityShareCapital"]
    out = valid_changes(kb, answer(
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:1", "concept": "ind-as:Equity", "reason": "makes the sum work"},
        {"problem_id": PROBLEM["id"], "line_id": "balanceSheet:2", "concept": "ind-as:Equity", "reason": "it is the total"},
    ), [PROBLEM], lines, allowed)
    assert [c["rowId"] for c in out] == ["balanceSheet:2"]
