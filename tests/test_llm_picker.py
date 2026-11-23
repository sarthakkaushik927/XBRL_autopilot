"""The AI pick never costs a batch its suggestions (2026-11-23: a Groq 400 used to fail /recommend with a 500)."""
import asyncio

import groq
import httpx
from langchain_core.runnables import RunnableLambda

from src.services.tagging import llm_picker
from src.services.tagging.llm_picker import Pick, Picks, pick_concepts

SHARED = [("ind-as:TradePayablesCurrent", "Trade payables current"), ("ind-as:BorrowingsCurrent", "Borrowings current")]
LINES = [{"id": 0, "item": "Short-term borrowings", "context": ""}, {"id": 1, "item": "Trade payables", "context": ""}]


class FakeLlm:
    """Stands in for get_llm(): records the structured-output method and answers with `answer`."""

    def __init__(self, answer):
        self.answer = answer
        self.method = None

    def with_structured_output(self, schema, method=None):
        self.method = method

        def run(_):
            if isinstance(self.answer, Exception):
                raise self.answer
            return self.answer

        return RunnableLambda(run)


def _bad_request() -> groq.BadRequestError:
    req = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    return groq.BadRequestError(
        "Tool call validation failed: attempted to call tool 'picks' which was not in request.tools",
        response=httpx.Response(400, request=req),
        body=None,
    )


def test_a_groq_error_leaves_the_local_order(monkeypatch):
    monkeypatch.setattr(llm_picker, "get_llm", lambda: FakeLlm(_bad_request()))
    assert asyncio.run(pick_concepts("BS", LINES, SHARED)) == {}


def test_asks_for_json_not_a_tool_call_and_keeps_valid_picks(monkeypatch):
    fake = FakeLlm(Picks(picks=[Pick(id=0, qname="ind-as:BorrowingsCurrent"), Pick(id=1, qname="ind-as:NotAllowed")]))
    monkeypatch.setattr(llm_picker, "get_llm", lambda: fake)
    assert asyncio.run(pick_concepts("BS", LINES, SHARED)) == {0: "ind-as:BorrowingsCurrent"}
    assert fake.method == "json_mode"


def test_the_prompt_names_json_and_the_shape():
    system = llm_picker.PROMPT.format_messages(sheet="BS", body="x")[0].content
    assert "JSON" in system and '"picks"' in system and '"qname"' in system
