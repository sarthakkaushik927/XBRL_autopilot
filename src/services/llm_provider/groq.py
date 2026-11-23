from collections.abc import Iterable
from functools import lru_cache

import groq
from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable
from langchain_groq import ChatGroq

from src.app_config import get_app_config

app_config = get_app_config()
DEFAULT_MODEL = app_config.groq_model or "openai/gpt-oss-120b"

AVAILABLE_MODELS = frozenset({
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "mixtral-8x7b-32768",
    "qwen/qwen3.8-27b",
    "canopylabs/orpheus-arabic-saudi",
    "canopylabs/orpheus-v1-english",
    "meta-llama/llama-prompt-guard-2-22m",
    "meta-llama/llama-prompt-guard-2-86m",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "openai/gpt-oss-safeguard-20b",
    DEFAULT_MODEL,
})

# Chat models tried after the chosen one when it is rate limited (Groq limits are per model).
# Override with GROQ_FALLBACK_MODELS="a,b,c".
DEFAULT_FALLBACK_MODELS: tuple[str, ...] = (
    "openai/gpt-oss-120b",
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant",
)

# A 429 must switch models at once: the groq client otherwise sleeps for the server's retry-after
# (36 s seen on 2026-11-21) before the fallback runs. Other errors are not retried here either.
RETRIES_PER_MODEL = 0


def fallback_chain(primary: str, fallbacks: Iterable[str]) -> list[str]:
    """The chosen model first, then each fallback once (no duplicates, blanks dropped)."""
    chain: list[str] = []
    for m in [primary, *fallbacks]:
        m = (m or "").strip()
        if m and m not in chain:
            chain.append(m)
    return chain


def configured_fallbacks() -> tuple[str, ...]:
    raw = app_config.groq_fallback_models
    return tuple(m.strip() for m in raw.split(",") if m.strip()) if raw else DEFAULT_FALLBACK_MODELS


def with_rate_limit_fallback(llms: list[BaseChatModel]) -> Runnable:
    """Runs on the first model; on a rate-limit error retries the same call on the next one.

    A model Groq no longer serves (404, retired from the list) is skipped the same way: on 2026-11-22 a 429 on the
    chosen model fell through to a retired fallback whose 404 ended the chain, and the AI pick was lost.
    A 400 is skipped too: Groq answers 400 when the model's own output fails validation (tool_use_failed,
    json_validate_failed), which another model usually gets right.

    `.with_structured_output(...)` / `.bind_tools(...)` on the result apply to every model in the chain.
    """
    if len(llms) == 1:
        return llms[0]
    return llms[0].with_fallbacks(llms[1:], exceptions_to_handle=(groq.RateLimitError, groq.NotFoundError, groq.BadRequestError))


def _chat_groq(model: str) -> ChatGroq:
    return ChatGroq(model=model, api_key=app_config.groq_api_key, max_retries=RETRIES_PER_MODEL)


@lru_cache
def get_llm(model: str | None = None):
    chain = fallback_chain(model or DEFAULT_MODEL, configured_fallbacks())
    return with_rate_limit_fallback([_chat_groq(m) for m in chain])
