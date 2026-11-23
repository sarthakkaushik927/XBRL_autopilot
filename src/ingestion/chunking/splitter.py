from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from src.core.logger import logger


def split(documents: list[Document]) -> list[Document]:
    with logger.span("splitter.split_documents", doc_count=len(documents)):
        logger.info("splitter.started", doc_count=len(documents))
        splitter = RecursiveCharacterTextSplitter(
            separators=["\n\n", "\n",". "," ", ""],
            chunk_size=1000,
            chunk_overlap=200,
        )
        chunks = splitter.split_documents(documents=documents)
        logger.info("splitter.completed", input_docs=len(documents), output_chunks=len(chunks))
        return chunks
