"""Local ranking of a sheet's scoped concepts for one line item (docs/15 §3 ELR scoping, docs/17).

Two local rankers over the same scope, merged by reciprocal-rank fusion:
- the embedding model the vector index uses (all-mpnet-base-v2): meaning ("Total assets" ~ "Assets");
- the FlashRank cross-encoder reranker: wording.
No network: the scope comes from the knowledge base, the models are local.
"""
from __future__ import annotations

from collections.abc import Sequence
from functools import lru_cache

import numpy as np
from langchain_core.documents import Document

from src.services.retrieval.reranker import get_reranker_service

RRF_K = 60  # standard reciprocal-rank-fusion constant
RERANK_POOL = 40  # cross-encoder candidates for big scopes (the embedding's best)
FUSE_DEPTH = 20


@lru_cache(maxsize=1)
def _embedder():
    from src.services.embeddings.huggingface import HuggingFaceEmbedding

    return HuggingFaceEmbedding()


def label_of(doc: Document) -> str:
    return doc.page_content.split(" | ")[0]


@lru_cache(maxsize=32)
def _scope_matrix(scope_key: str, labels: tuple[str, ...]) -> np.ndarray:
    m = np.array(_embedder().embed_documents(list(labels)), dtype=np.float32)
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def embedding_order(scope_key: str, docs: Sequence[Document], query: str) -> tuple[list[int], np.ndarray]:
    """Scope indexes by cosine similarity to the query (best first) and the similarities."""
    matrix = _scope_matrix(scope_key, tuple(label_of(d) for d in docs))
    v = np.array(_embedder().embed_query(query), dtype=np.float32)
    sims = matrix @ (v / np.linalg.norm(v))
    return [int(i) for i in np.argsort(-sims)], sims


def rerank_order(docs: Sequence[Document], pool: Sequence[int], query: str) -> list[int]:
    """Pool indexes ordered by the cross-encoder."""
    by_content = {docs[i].page_content: i for i in pool}
    fresh = [Document(page_content=docs[i].page_content, metadata=dict(docs[i].metadata or {})) for i in pool]
    ranked = get_reranker_service().rerank(query=query, candidates=fresh, top_k=len(fresh))
    return [by_content[r.document.page_content] for r in ranked if r.document.page_content in by_content]


def fuse(*orders: Sequence[int], depth: int = FUSE_DEPTH) -> list[int]:
    """Reciprocal-rank fusion of several best-first index lists."""
    score: dict[int, float] = {}
    for order in orders:
        for rank, i in enumerate(order[:depth]):
            score[i] = score.get(i, 0.0) + 1.0 / (RRF_K + rank + 1)
    return sorted(score, key=lambda i: -score[i])


def rank_scope(scope_key: str, docs: Sequence[Document], query: str) -> list[tuple[int, float]]:
    """Best-first (scope index, cosine similarity) for one line item."""
    emb, sims = embedding_order(scope_key, docs, query)
    pool = list(range(len(docs))) if len(docs) <= RERANK_POOL else emb[:RERANK_POOL]
    rr = rerank_order(docs, pool, query)
    return [(i, float(sims[i])) for i in fuse(emb, rr)]
