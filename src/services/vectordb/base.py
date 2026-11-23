from abc import ABC, abstractmethod

from langchain_core.documents import Document


class BaseVectorDB(ABC):
    """Abstract base class defining the standard interface for vector databases."""

    @abstractmethod
    def add(self, documents: list[Document]) -> list[str]:
        """Synchronously add documents to the database."""

    @abstractmethod
    async def aadd(self, documents: list[Document]) -> list[str]:
        """Asynchronously add documents to the database."""

    @abstractmethod
    def search(self, query: str, k: int) -> list[Document]:
        """Synchronously search the database for relevant documents."""

    @abstractmethod
    async def asearch(self, query: str, k: int) -> list[Document]:
        """Asynchronously search the database for relevant documents."""
