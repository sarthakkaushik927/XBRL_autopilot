import asyncio
from typing import Any, Literal

from langchain_core.documents import Document

from src.constants import HYBRID_SEARCH_K, IND_AS_TAXONOMY_VDB
from src.core.logger import logger
from src.services.retrieval.hybrid import get_hybrid_search_service
from src.services.retrieval.reranker import get_reranker_service
from src.services.sheet_scope import (
    axis_members,
    knowledge_base,
    scope_concepts,
    scope_documents,
)
from src.services.tagging.llm_picker import pick_concepts
from src.services.tagging.scoped_ranker import label_of, rank_scope
from src.utils.main_utils import restore_metadata

from .base import Pipeline

Kind = Literal["concept", "member"]
LLM_CANDIDATES = 8  # per line, for scopes too big to send whole
LLM_SHARED_SCOPE_MAX = 200  # statement ELRs and table axes are sent whole, once per sheet


def _clean(doc: Document, score: float, **extra: Any) -> Document:
    meta = restore_metadata(dict(doc.metadata or {}))
    meta.pop("score", None)
    meta["relevance_score"] = float(round(score, 4))
    meta.update(extra)
    for mk, mv in list(meta.items()):
        if hasattr(mv, "item"):
            meta[mk] = mv.item()
    return Document(page_content=doc.page_content, metadata=meta)


async def _scoped(
    keys: list[str], contexts: list[str], scope: str, kind: Kind, top_k: int, use_llm: bool
) -> list[list[Document]]:
    """docs/15 §3: candidates are only the sheet's ELR concepts (or its table axis members)."""
    kb = knowledge_base()
    qnames = axis_members(kb, scope) if kind == "member" else scope_concepts(kb, scope)
    docs = scope_documents(kb, qnames)
    scope_key = f"{scope}:{kind}"
    # embedding + reranking is CPU work: off the event loop, so /health and the other routes keep answering while
    # a sheet is auto-tagged (PR #15 review: the app looked hung / "backend not reachable" during Auto-tag)
    ranked = await asyncio.to_thread(lambda: [rank_scope(scope_key, docs, key) if key else [] for key in keys])

    picks: dict[int, str] = {}
    if use_llm:
        cand = lambda j: (docs[j].metadata["qname"], label_of(docs[j]))
        shared = [cand(j) for j in range(len(docs))] if len(docs) <= LLM_SHARED_SCOPE_MAX else None
        lines = [
            {"id": i, "item": key, "context": contexts[i], **({} if shared else {"candidates": [cand(j) for j, _ in r[:LLM_CANDIDATES]]})}
            for i, (key, r) in enumerate(zip(keys, ranked))
            if key and r
        ]
        picks = await pick_concepts(scope.replace("CANONICAL_", "").replace("_", " "), lines, shared)
        # a pick outside the local list (possible with the shared scope) is added so it can come first
        for i, q in picks.items():
            j = next((j for j in range(len(docs)) if docs[j].metadata["qname"] == q), None)
            if j is not None and all(jj != j for jj, _ in ranked[i]):
                ranked[i] = [(j, 0.0), *ranked[i]]

    out: list[list[Document]] = []
    for i, r in enumerate(ranked):
        pick = picks.get(i)
        # the AI's pick first (stable sort keeps the local order for the rest)
        order = sorted(r, key=lambda js: docs[js[0]].metadata["qname"] != pick) if pick else r
        out.append([
            _clean(docs[j], s, **({"pickedBy": "ai"} if docs[j].metadata["qname"] == pick else {}))
            for j, s in order[: max(top_k, 1)]
        ])
    return out


async def RecommendTaxonomies(
    keys: list[str],
    collection= IND_AS_TAXONOMY_VDB,
    top_k: int = 1,
    filter:dict | None=None,
    scope: str | None = None,
    kind: Kind = "concept",
    contexts: list[str] | None = None,
    use_llm: bool = False,
) -> list[list[Document]]:
    """Top taxonomy concepts per line-item key.

    One list per key, in the order of `keys` (empty when nothing matched), so callers can tell which
    suggestions belong to which line when top_k > 1.

    `scope` = a canonical sheet name: only that sheet's ELR concepts are candidates (docs/15 §3 ELR scoping),
    ranked locally; `kind="member"` ranks the members of the sheet's table axis (SOCIE components, PPE classes).
    `contexts` = each key's headings; `use_llm` = let the LLM pick among each line's best candidates.
    Without `scope`: Hybrid Search + Reranker over the whole taxonomy (unchanged).
    """
    clean_keys = [k.strip() if isinstance(k, str) else "" for k in keys]
    ctx = [(c or "").strip() for c in (contexts or [])] + [""] * max(0, len(clean_keys) - len(contexts or []))
    with logger.span("pipeline.recommend_taxonomies", total_keys=len(keys), scope=scope or "all", kind=kind, use_llm=use_llm):
        if scope:
            results = await _scoped(clean_keys, ctx, scope, kind, top_k, use_llm)
            logger.info("pipeline.recommend_taxonomies.completed", results_count=len(results))
            return results

        hybrid_svc = get_hybrid_search_service()
        reranker = get_reranker_service()
        results: list[list[Document]] = []

        for key in clean_keys:
            if not key:
                results.append([])
                continue

            candidates = await hybrid_svc.asearch(
                query=key,
                collection=collection,
                k=max(HYBRID_SEARCH_K, top_k),
                filter=filter,
            )
            if not candidates:
                results.append([])
                continue

            ranked = await asyncio.to_thread(reranker.rerank, query=key, candidates=candidates, top_k=top_k)
            results.append([_clean(r.document, r.score) for r in (ranked or [])[: max(top_k, 1)]])

        logger.info("pipeline.recommend_taxonomies.completed", results_count=len(results))
        return results



class RecommendationPipeline(Pipeline):
    def __init__(self):
        pass

    async def initiate(
        self,
        keys: list[str],
        collection = IND_AS_TAXONOMY_VDB,
        top_k: int = 3,
        filter:dict | None=None,
        scope: str | None = None,
        kind: Kind = "concept",
        contexts: list[str] | None = None,
        use_llm: bool = False,
    ) -> list[list[Document]]:
        return await RecommendTaxonomies(keys=keys, collection=collection, top_k=top_k, filter=filter, scope=scope, kind=kind, contexts=contexts, use_llm=use_llm)
