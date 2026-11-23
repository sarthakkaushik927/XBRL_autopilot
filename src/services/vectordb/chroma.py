import os
from typing import Any, Literal

from langchain_chroma import Chroma
from langchain_core.documents import Document

from src.constants import (
    CI_TAXONOMY_VDB,
    COSTING_TAXONOMY_VDB,
    IND_AS_TAXONOMY_VDB,
    VECTOR_DB_PATH,
)
from src.core.logger import logger

from .base import BaseVectorDB


class ChromaVectorDB(BaseVectorDB):
    def __init__(self, embedding_function: Any | None = None, **kwargs):
        super().__init__()
        with logger.span("vectordb.init", collection_name=IND_AS_TAXONOMY_VDB, persist_directory=os.path.join(VECTOR_DB_PATH,IND_AS_TAXONOMY_VDB)):
            self.vector_store_ind = Chroma(
                collection_name=IND_AS_TAXONOMY_VDB,
                persist_directory=os.path.join(VECTOR_DB_PATH,IND_AS_TAXONOMY_VDB),
                embedding_function=embedding_function,
                **kwargs
            )

        with logger.span("vectordb.init", collection_name=CI_TAXONOMY_VDB, persist_directory=os.path.join(VECTOR_DB_PATH,CI_TAXONOMY_VDB)):

            self.vector_store_ci = Chroma(
                            collection_name=CI_TAXONOMY_VDB,
                            persist_directory=os.path.join(VECTOR_DB_PATH,CI_TAXONOMY_VDB),
                            embedding_function=embedding_function,
                            **kwargs
                        )

        with logger.span("vectordb.init", collection_name=COSTING_TAXONOMY_VDB, persist_directory=os.path.join(VECTOR_DB_PATH,COSTING_TAXONOMY_VDB)):

            self.vector_store_cost = Chroma(
                            collection_name=COSTING_TAXONOMY_VDB,
                            persist_directory=os.path.join(VECTOR_DB_PATH,COSTING_TAXONOMY_VDB),
                            embedding_function=embedding_function,
                            **kwargs
                        )

    def add(self, documents: list[Document],collection:Literal[IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB]=IND_AS_TAXONOMY_VDB) -> list[str]:
        with logger.span("vectordb.add", count=len(documents),collection=collection):
            match collection:
                case x if x==IND_AS_TAXONOMY_VDB:
                    return self.vector_store_ind.add_documents(documents=documents)

                case x if x==CI_TAXONOMY_VDB:
                    return self.vector_store_ci.add_documents(documents=documents)

                case x if x==COSTING_TAXONOMY_VDB:
                    return self.vector_store_cost.add_documents(documents=documents)
                
    async def aadd(self, documents: list[Document],collection:Literal[IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB]=IND_AS_TAXONOMY_VDB) -> list[str]:
        with logger.span("vectordb.aadd", count=len(documents),collection=collection):
            match collection:
                case x if x ==IND_AS_TAXONOMY_VDB:
                    return await self.vector_store_ind.aadd_documents(documents=documents)

                case x if x==CI_TAXONOMY_VDB:
                    return await self.vector_store_ci.aadd_documents(documents=documents)

                case x if x==COSTING_TAXONOMY_VDB:
                    return await self.vector_store_cost.aadd_documents(documents=documents)
                            
    def search(self, query: str, k: int = 4,collection:Literal[IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB]=IND_AS_TAXONOMY_VDB) -> list[Document]:
        with logger.span("vectordb.search", query=query, k=k,collection=collection):
            match collection:
                case x if x ==IND_AS_TAXONOMY_VDB:
                    return self.vector_store_ind.similarity_search(query=query, k=k)

                case x if x == CI_TAXONOMY_VDB:
                    return self.vector_store_ci.similarity_search(query=query, k=k)

                case x if x==COSTING_TAXONOMY_VDB:
                    return self.vector_store_cost.similarity_search(query=query, k=k)
                              

    async def asearch(self, query: str, k: int = 4,collection:Literal[IND_AS_TAXONOMY_VDB,CI_TAXONOMY_VDB,COSTING_TAXONOMY_VDB]=IND_AS_TAXONOMY_VDB) -> list[Document]:
        with logger.span("vectordb.asearch", query=query, k=k,collection=collection):
            match collection:
                case x if x ==IND_AS_TAXONOMY_VDB:
                    return await self.vector_store_ind.asimilarity_search(query=query, k=k)

                case x if x==CI_TAXONOMY_VDB:
                    return await self.vector_store_ci.asimilarity_search(query=query, k=k)

                case x if x==COSTING_TAXONOMY_VDB:
                    return await self.vector_store_cost.asimilarity_search(query=query, k=k)
                              

