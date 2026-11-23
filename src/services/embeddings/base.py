from abc import ABC, abstractmethod


class BaseEmbedding(ABC):
    """Abstract base class defining the standard interface for embedding models."""

    @abstractmethod
    def embed(self, text: str | list[str]) -> list[float] | list[list[float]]:
        """
        Synchronously generate embeddings for a single string or a list of strings.
        
        Args:
            text: A single string (str) or a list of strings (List[str]).
            
        Returns:
            A 1D embedding vector (List[float]) for a single string, 
            or a 2D list of embedding vectors (List[List[float]]) for a list of strings.
        """

    @abstractmethod
    async def aembed(self, text: str | list[str]) -> list[float] | list[list[float]]:
        """
        Asynchronously generate embeddings for a single string or a list of strings.
        
        Args:
            text: A single string (str) or a list of strings (List[str]).
            
        Returns:
            A 1D embedding vector (List[float]) for a single string, 
            or a 2D list of embedding vectors (List[List[float]]) for a list of strings.
        """
