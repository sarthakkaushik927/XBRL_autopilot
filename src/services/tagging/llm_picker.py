"""AI at a decision point (Vashu, docs/17): the LLM picks one concept per line from the sheet's scoped concepts.

Only line-item names and their headings are sent (no amounts, no company data). Small scopes (a statement's ELR,
a table axis) are sent once as the shared candidate list; big scopes (the notes) send each line's best local
candidates. The answer is checked: a pick must be one of that line's candidates, otherwise it is ignored.
The result is a proposal the CA accepts or not.
"""
from __future__ import annotations

from typing import Optional

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from src.core.logger import logger
from src.services.llm_provider.groq import get_llm

Candidate = tuple[str, str]  # (qname, label)


class Pick(BaseModel):
    id: int = Field(description="the line id")
    qname: Optional[str] = Field(description="the chosen concept qname, or null when none fits")


class Picks(BaseModel):
    picks: list[Pick]


PROMPT = ChatPromptTemplate.from_messages([
    (
        "system",
        "You are an Indian chartered accountant tagging an AOC-4 Ind AS XBRL filing. For each line of the "
        "{sheet}, choose the single taxonomy concept that the line reports, only from the allowed concepts given. "
        "Read the line with its headings and use Schedule III / Ind AS meaning, not just matching words (for "
        "example long-term means non-current, short-term means current, and a 'Total' line is the total concept "
        "itself). Return null when no allowed concept fits.",
    ),
    ("human", "{body}"),
])


def _line(ln: dict) -> str:
    ctx = f"  (headings: {ln['context']})" if ln.get("context") else ""
    return f"Line {ln['id']}: {ln['item']}{ctx}"


def render(lines: list[dict], shared: Optional[list[Candidate]]) -> str:
    if shared is not None:
        concepts = "\n".join(f"- {q}: {label}" for q, label in shared)
        return f"Allowed concepts (for every line):\n{concepts}\n\nLines:\n" + "\n".join(_line(ln) for ln in lines)
    blocks = []
    for ln in lines:
        cands = "\n".join(f"    - {q}: {label}" for q, label in ln["candidates"])
        blocks.append(f"{_line(ln)}\n  allowed concepts:\n{cands}")
    return "\n\n".join(blocks)


def valid_picks(res: Picks, lines: list[dict], shared: Optional[list[Candidate]]) -> dict[int, str]:
    """Only picks from the line's allowed concepts survive."""
    shared_set = {q for q, _ in shared} if shared is not None else None
    allowed = {ln["id"]: shared_set if shared_set is not None else {q for q, _ in ln["candidates"]} for ln in lines}
    return {p.id: p.qname for p in res.picks if p.qname and p.qname in allowed.get(p.id, set())}


async def pick_concepts(sheet: str, lines: list[dict], shared: Optional[list[Candidate]] = None) -> dict[int, str]:
    """lines: [{id, item, context, candidates?}] -> {id: qname} for the valid picks ({} when the LLM fails)."""
    if not lines:
        return {}
    try:
        chain = PROMPT | get_llm().with_structured_output(Picks)
        res: Picks = await chain.ainvoke({"sheet": sheet, "body": render(lines, shared)})
    except Exception as e:  # no key, network, every model rate limited: the local order stands
        logger.warning("llm_picker.failed", sheet=sheet, error=str(e))
        return {}
    picked = valid_picks(res, lines, shared)
    logger.info("llm_picker.done", sheet=sheet, lines=len(lines), picked=len(picked))
    return picked
