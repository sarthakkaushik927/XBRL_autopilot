
from langchain_huggingface import HuggingFaceEmbeddings

from src.core.logger import logger

from .base import BaseEmbedding


class HuggingFaceEmbedding(BaseEmbedding):
    def __init__(
        self,
        model_name: str = "sentence-transformers/all-mpnet-base-v2",
        **kwargs
    ):
        super().__init__()
        self.model_name = model_name
        with logger.span("embeddings.init", model_name=model_name):
            self.embedding_model = HuggingFaceEmbeddings(model_name=model_name, **kwargs)

    def embed(self, text: str | list[str]) -> list[float] | list[list[float]]:
        with logger.span("embeddings.embed", is_batch=isinstance(text, list)):
            if isinstance(text, str):
                return self.embedding_model.embed_query(text)
            elif isinstance(text, list):
                return self.embedding_model.embed_documents(text)
            logger.error("embeddings.invalid_input", input_type=type(text).__name__)
            raise ValueError("Input must be a string (str) or a list of strings (list[str]).")

    async def aembed(self, text: str | list[str]) -> list[float] | list[list[float]]:
        with logger.span("embeddings.aembed", is_batch=isinstance(text, list)):
            if isinstance(text, str):
                return await self.embedding_model.aembed_query(text)
            elif isinstance(text, list):
                return await self.embedding_model.aembed_documents(text)
            logger.error("embeddings.invalid_input", input_type=type(text).__name__)
            raise ValueError("Input must be a string (str) or a list of strings (list[str]).")

    async def embedd(self, text: str | list[str]) -> list[float] | list[list[float]]:
        return await self.aembed(text)

    # fall back for some files
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self.embedding_model.embed_documents(texts)

    def embed_query(self, text: str) -> list[float]:
        return self.embedding_model.embed_query(text)

    @property
    def dim(self) -> int:
        return 768