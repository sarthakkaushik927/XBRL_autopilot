"""Fix with AI for the Ind AS Problems panel (Sarthak, 2026-11-22; docs/17 log).

The app sends the totals that don't add up (the live Difference check) and the lines of the statements involved
(label, headings, amounts, current tag). The prompt adds the knowledge base's calculation relationships around each
problem's concept (parent = sum of weight x child, with labels), so the AI reasons with the taxonomy's arithmetic.

The AI only proposes (CLAUDE.md non-negotiable 2): a list of changes, each "line -> another concept / opening or
closing balance / no tag", with a reason. Every change is checked here (known line, allowed concept, a real change,
an opening balance only for an instant concept); the app then dry-runs each one with its own Difference check and
the user accepts them one by one. Amounts may go to the AI (Sarthak, 2026-11-22); identity data (company name, CIN,
PAN, DINs) is never part of the request.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import Any, Literal

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from src.core.logger import logger
from src.services.llm_provider.groq import get_llm
from src.services.sheet_scope import scope_concepts

# A sheet's whole scope is offered when it is this small (BS 57); bigger ones (P&L 141, CF 105, notes 1,843) get the
# calculation neighbourhood of the problems instead.
SMALL_SCOPE = 80
MAX_ALLOWED = 250
# Groq's free tier allows 8,000 tokens per minute per model: a 28-problem Fix all on DGPL asked for 39,400 and was
# refused (2026-11-22). Fix all is asked in parts of about this many prompt characters (~3,000 tokens with the
# instructions and the answer schema); a part that hits the limit moves on to the next model of the chain.
PROMPT_BUDGET = 15_000
# A part that hits the per-minute limit waits for it (Groq says how long) while Fix all is within this many seconds
# (the app gives the request 300 s).
FIX_DEADLINE_S = 240
# A statement with more lines than this (the notes) sends only the lines around each problem.
WHOLE_STATEMENT = 60
MAX_LINES_PER_PROBLEM = 40


# ---------------------------------------------------------------- what the AI answers (structured output)
class ProposedChange(BaseModel):
    problem_id: str = Field(description="the id of the problem this change fixes")
    line_id: str = Field(description="the id of the line to change")
    concept: str | None = Field(
        description="the concept qname the line should be tagged with (one of the allowed concepts); "
        "null to remove the line's tag (e.g. a line counted twice)"
    )
    period_role: Literal["start", "end"] | None = Field(
        default=None,
        description="only for balances: 'start' = the line is an opening balance, 'end' = a closing balance",
    )
    reason: str = Field(description="one sentence a chartered accountant understands")


class FixAnswer(BaseModel):
    explanation: str = Field(description="what is wrong, in two or three sentences")
    changes: list[ProposedChange]


PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        ("You are an Indian chartered accountant reviewing the XBRL tags of an AOC-4 Ind AS filing. Each problem is a "
        "total that does not equal the sum of its tagged parts under the taxonomy's calculation relationships (given "
        "with their weights). How the check works: the calculated sum adds the parts that are tagged (lines tagged "
        "with the same concept are added together); untagged parts and lines marked [opening balance] do not count; "
        "every other line is a closing balance or an amount for the year. Find the lines tagged wrongly and propose "
        "the smallest set of tag changes that makes the totals add up: retag a line to the right concept, mark a "
        "balance as an opening balance (period_role 'start'), or remove a tag (concept null) when a line is counted "
        "twice. Use Schedule III / Ind AS meaning (long-term = non-current, short-term = current) and check your "
        "arithmetic with the amounts before proposing. Only use the allowed concepts and the line ids given. You "
        "change tags, never figures: when the workbook's own figures don't add up, say so and propose nothing for "
        "that total. Never tag a part with its total's concept just to make a sum work (share capital stays share "
        "capital): when the line that reports a total is missing or untagged, say so instead. In the explanation and "
        "the reasons, name lines by their line item (never by id or qname alone) and don't mention field names; "
        "write for an accountant."),
    ),
    ("human", "{body}"),
])


# ---------------------------------------------------------------- the knowledge base around a problem
def _label(kb: dict[str, Any], qname: str) -> str:
    c = kb.get("concepts", {}).get(qname) or {}
    return (c.get("labels") or {}).get("label") or c.get("name") or qname


def _period_type(kb: dict[str, Any], qname: str) -> str | None:
    return (kb.get("concepts", {}).get(qname) or {}).get("periodType")


def _arcs(kb: dict[str, Any], elr: str | None) -> list[dict[str, Any]]:
    calc = kb.get("calculation", {})
    if elr and elr in calc:
        return calc[elr]
    return [a for arcs in calc.values() for a in arcs]


def equations(kb: dict[str, Any], concept: str, elr: str | None) -> list[tuple[str, list[tuple[str, float]]]]:
    """The calculations that hold the concept: its own (as the total), then the one it is a part of."""
    arcs = _arcs(kb, elr)
    out: list[tuple[str, list[tuple[str, float]]]] = []
    parents = [concept] + [a["from"] for a in arcs if a["to"] == concept]
    for p in dict.fromkeys(parents):
        kids = [(a["to"], float(a.get("weight", 1))) for a in arcs if a["from"] == p]
        if kids:
            out.append((p, kids))
    return out


def neighbourhood(kb: dict[str, Any], concept: str, elr: str | None) -> list[str]:
    """The concept, its parts (two levels), the totals it belongs to and their other parts."""
    arcs = [a for arcs in kb.get("calculation", {}).values() for a in arcs]
    children: dict[str, list[str]] = {}
    parents: dict[str, list[str]] = {}
    for a in arcs:
        children.setdefault(a["from"], []).append(a["to"])
        parents.setdefault(a["to"], []).append(a["from"])
    out: dict[str, None] = {concept: None}
    for c in children.get(concept, []):
        out[c] = None
        out.update(dict.fromkeys(children.get(c, [])))
    for p in parents.get(concept, []):
        out[p] = None
        out.update(dict.fromkeys(children.get(p, [])))
    return list(out)


def totals_above(kb: dict[str, Any], concept: str) -> set[str]:
    """Every total the concept rolls up into (its calculation ancestors, all ELRs)."""
    parents: dict[str, set[str]] = {}
    for arcs in kb.get("calculation", {}).values():
        for a in arcs:
            parents.setdefault(a["to"], set()).add(a["from"])
    out: set[str] = set()
    stack = [concept]
    while stack:
        for p in parents.get(stack.pop(), ()):
            if p not in out:
                out.add(p)
                stack.append(p)
    return out


def allowed_concepts(kb: dict[str, Any], problems: list[dict], lines: list[dict]) -> list[str]:
    """Concepts the AI may propose: small sheet scopes whole, else the problems' calculation neighbourhood."""
    out: dict[str, None] = {}
    for sheet in dict.fromkeys(ln["sheet"] for ln in lines):
        try:
            scope = scope_concepts(kb, sheet)
        except ValueError:
            continue
        if len(scope) <= SMALL_SCOPE:
            out.update(dict.fromkeys(scope))
    for p in problems:
        out.update(dict.fromkeys(neighbourhood(kb, p["concept"], p.get("elr"))))
    out.update(dict.fromkeys(ln["concept"] for ln in lines if ln.get("concept")))
    concepts = kb.get("concepts", {})
    return [q for q in out if q in concepts][:MAX_ALLOWED]


# ---------------------------------------------------------------- what goes into one request
def _section(ln: dict) -> str:
    """A line's first two headings ("assets > current assets"): the parts of one total sit under them."""
    return " > ".join(h.strip() for h in (ln.get("headings") or "").split(">")[:2]).lower()


def relevant_lines(kb: dict[str, Any], problem: dict, lines: list[dict]) -> list[dict]:
    """A long statement's lines around a problem: those tagged inside its calculation neighbourhood, plus the other
    lines under the same headings (where a wrongly tagged part sits), at most MAX_LINES_PER_PROBLEM."""
    near = set(neighbourhood(kb, problem["concept"], problem.get("elr")))
    seeds = {ln["id"] for ln in lines if ln.get("concept") in near}
    sections = {_section(ln) for ln in lines if ln["id"] in seeds} - {""}
    return [ln for ln in lines if ln["id"] in seeds or _section(ln) in sections][:MAX_LINES_PER_PROBLEM]


def plan(kb: dict[str, Any], problems: list[dict], lines: list[dict]) -> list[tuple[list[dict], list[dict]]]:
    """The requests Fix all is asked in: problems grouped by statement, each part with its lines, within PROMPT_BUDGET
    (a single problem that is bigger still goes alone)."""
    order = {ln["id"]: i for i, ln in enumerate(lines)}
    by_statement: dict[str, list[dict]] = {}
    for ln in lines:
        by_statement.setdefault(ln["statement"], []).append(ln)

    def ordered(chosen: dict[str, dict]) -> list[dict]:
        return sorted(chosen.values(), key=lambda ln: order[ln["id"]])

    chunks: list[tuple[list[dict], list[dict]]] = []
    for statement in dict.fromkeys(p.get("statement") or "" for p in problems):
        st_lines = by_statement.get(statement) or (lines if not statement else [])
        cur_p: list[dict] = []
        cur_l: dict[str, dict] = {}
        for p in (x for x in problems if (x.get("statement") or "") == statement):
            mine = st_lines if len(st_lines) <= WHOLE_STATEMENT else relevant_lines(kb, p, st_lines)
            cand_p, cand_l = cur_p + [p], {**cur_l, **{ln["id"]: ln for ln in mine}}
            body = render(kb, cand_p, ordered(cand_l), allowed_concepts(kb, cand_p, ordered(cand_l)))
            if cur_p and len(body) > PROMPT_BUDGET:
                chunks.append((cur_p, ordered(cur_l)))
                cur_p, cur_l = [p], {ln["id"]: ln for ln in mine}
            else:
                cur_p, cur_l = cand_p, cand_l
        if cur_p:
            chunks.append((cur_p, ordered(cur_l)))
    return chunks


# ---------------------------------------------------------------- prompt
def _weight(w: float) -> str:
    return "+" if w >= 0 else "-"


def _amount(v: Any) -> str:
    return "blank" if v is None or v == "" else str(v)


def render(kb: dict[str, Any], problems: list[dict], lines: list[dict], allowed: list[str]) -> str:
    blocks = ["Problems:"]
    for p in problems:
        blocks.append(f"- Problem {p['id']}: {p['message']}")
        for total, parts in equations(kb, p["concept"], p.get("elr")):
            terms = " ".join(f"{_weight(w)} {q} ({_label(kb, q)})" for q, w in parts)
            blocks.append(f"    calculation: {total} ({_label(kb, total)}) = {terms}")
    blocks.append("\nLines (id | line item | headings | current year | previous year | tagged as):")
    for ln in lines:
        tag = ln.get("concept") or "untagged"
        if ln.get("concept") and ln.get("periodRole") == "start":
            tag += " [opening balance]"
        blocks.append(f"{ln['id']} | {ln['label']} | {ln.get('headings') or '-'} | {_amount(ln.get('cy'))} | {_amount(ln.get('py'))} | {tag}")
    blocks.append("\nAllowed concepts (qname: label, period type):")
    blocks.extend(f"- {q}: {_label(kb, q)}, {_period_type(kb, q) or '-'}" for q in allowed)
    return "\n".join(blocks)


# ---------------------------------------------------------------- the guard rails
def valid_changes(kb: dict[str, Any], answer: FixAnswer, problems: list[dict], lines: list[dict], allowed: list[str]) -> list[dict]:
    """Only real, applicable changes survive: known line and problem, allowed concept, opening balance on an instant."""
    by_id = {ln["id"]: ln for ln in lines}
    problem_ids = {p["id"] for p in problems}
    allowed_set = set(allowed)
    out: list[dict] = []
    seen: set[str] = set()
    for ch in answer.changes:
        line = by_id.get(ch.line_id)
        if line is None or ch.line_id in seen:
            continue
        # the problem only groups the card: a miscopied id falls back to the request's first problem
        problem_id = ch.problem_id if ch.problem_id in problem_ids else problems[0]["id"]
        current = line.get("concept") or ""
        concept = ch.concept or ""
        if concept and concept not in allowed_set:
            continue
        if not concept and not current:
            continue  # removing a tag the line doesn't have
        if concept and current and concept in totals_above(kb, current) and not line["label"].strip().lower().startswith("total"):
            # a part retagged as its own total makes the sum work but files share capital as total equity
            # (seen live on DGPL, 2026-11-22); only a "Total …" line may move up to a total
            continue
        instant = bool(concept) and _period_type(kb, concept) == "instant"
        current_role = line.get("periodRole") or "end"
        # an opening balance only exists for a balance (instant) concept; otherwise the line keeps its role
        role = (ch.period_role or current_role) if instant else "end"
        if concept == current and role == current_role:
            continue  # no change
        change = {"problemId": problem_id, "rowId": ch.line_id, "concept": concept, "conceptLabel": _label(kb, concept) if concept else "", "reason": ch.reason.strip()}
        if concept and role != current_role:
            change["periodRole"] = role
        seen.add(ch.line_id)
        out.append(change)
    return out


async def propose_fix(kb: dict[str, Any], problems: list[dict], lines: list[dict]) -> dict:
    """problems: [{id, message, concept, elr, year, statement}]; lines: [{id, statement, sheet, label, headings, cy,
    py, concept, periodRole}] -> {explanation, changes: [{problemId, rowId, concept, conceptLabel, periodRole?, reason}]}.

    Fix all is asked in parts that fit the token limit (`plan`), one after the other. A part that fails is named in
    the explanation and the others still count; raises when every part failed (the app says so; nothing changes).
    """
    chain = PROMPT | get_llm().with_structured_output(FixAnswer)
    chunks = plan(kb, merge_years(problems), lines)
    deadline = time.monotonic() + FIX_DEADLINE_S
    explanations: list[str] = []
    changes: list[dict] = []
    failed: list[tuple[list[dict], Exception]] = []
    for part_problems, part_lines in chunks:
        # short problem ids in the prompt (P1, P2 …): models miscopy long ones; mapped back below
        aliased = [{**p, "id": f"P{i + 1}"} for i, p in enumerate(part_problems)]
        real = {a["id"]: p["id"] for a, p in zip(aliased, part_problems)}
        allowed = allowed_concepts(kb, aliased, part_lines)
        try:
            answer = await _ask(chain, render(kb, aliased, part_lines, allowed), deadline)
        except (RuntimeError, TimeoutError, ConnectionError, ValueError, OSError) as e:  # no key, network, every model of the chain rate limited
            logger.exception("indas_fix.part_failed", problems=len(part_problems), error=str(e)[:300])
            failed.append((part_problems, e))
            continue
        explanations.append(answer.explanation.strip())
        taken = {c["rowId"] for c in changes}
        for c in valid_changes(kb, answer, aliased, part_lines, allowed):
            if c["rowId"] not in taken:
                changes.append({**c, "problemId": real[c["problemId"]]})
    if failed and len(failed) == len(chunks):
        raise RuntimeError(_why([e for _, e in failed]))
    if failed:
        explanations.append(f"{sum(len(p) for p, _ in failed)} total(s) were not checked: {_why([e for _, e in failed])}.")
    logger.info("indas_fix.done", problems=len(problems), lines=len(lines), parts=len(chunks), failed=len(failed), valid=len(changes))
    return {"explanation": "\n\n".join(explanations), "changes": changes}


def merge_years(problems: list[dict]) -> list[dict]:
    """The CY and PY problems of one total become one (the same lines and tags explain both); the first id stands."""
    merged: dict[tuple[str, str], dict] = {}
    for p in problems:
        key = (p.get("statement") or "", p["concept"])
        if key in merged:
            merged[key] = {**merged[key], "message": f"{merged[key]['message']}; {p['message']}"}
        else:
            merged[key] = dict(p)
    return list(merged.values())


def _rate_limited(error: Exception) -> bool:
    text = str(error)
    return "rate_limit" in text or "Request too large" in text or "429" in text


def _malformed(error: Exception) -> bool:
    text = str(error)
    return "tool_use_failed" in text or "parse tool call" in text


def _retry_after(error: Exception) -> float:
    """Groq's "Please try again in 7.5s" / "in 820ms" (default 10 s)."""
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)(ms|s)", str(error))
    if not m:
        return 10.0
    seconds = float(m.group(2)) / (1000 if m.group(3) == "ms" else 1)
    return seconds + 60 * int(m.group(1) or 0)


async def _ask(chain: Any, body: str, deadline: float) -> FixAnswer:
    """One part. A malformed answer (Groq 400 "tool_use_failed") is asked once more; a rate limit is waited out
    (as long as Groq says) while the deadline allows."""
    malformed_retried = False
    while True:
        try:
            return await chain.ainvoke({"body": body})
        except Exception as e:
            if _malformed(e) and not malformed_retried:
                malformed_retried = True
                logger.warning("indas_fix.retry_malformed")
                continue
            wait = _retry_after(e) + 0.5
            if not _rate_limited(e) or time.monotonic() + wait > deadline:
                raise
            logger.info("indas_fix.wait_rate_limit", seconds=round(wait, 1))
            await asyncio.sleep(wait)


def _why(errors: list[Exception]) -> str:
    """Why parts failed, as the accountant reads it (Groq's error texts are long and technical)."""
    reasons: dict[str, int] = {}
    for e in errors:
        if _rate_limited(e):
            r = "the AI service's per-minute limit was reached, ask again in a minute"
        elif _malformed(e):
            r = "the AI's answer was malformed twice, ask again"
        else:
            r = str(e)[:300]
        reasons[r] = reasons.get(r, 0) + 1
    return "; ".join(r if n == 1 or len(reasons) == 1 else f"{r} ({n} parts)" for r, n in reasons.items())
