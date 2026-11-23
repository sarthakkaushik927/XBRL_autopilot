from collections.abc import Iterator

from bs4 import BeautifulSoup
from langchain_core.document_loaders.base import BaseLoader
from langchain_core.documents import Document

from src.core.logger import logger


class HTMLLoader(BaseLoader):
    def __init__(self, file_path: str):
        self.file_path = file_path

    def lazy_load(self) -> Iterator[Document]:
        try:
            logger.info("Opening HTML file", file_path=self.file_path)
            with open(file=self.file_path, encoding="utf-8", errors="ignore") as f:
                content = f.read()
            logger.debug("HTML file read", file_path=self.file_path, raw_size=len(content))

            soup = BeautifulSoup(content, "html.parser")
            for script in soup(["script", "style", "meta", "noscript"]):
                script.decompose()

            text = soup.get_text(separator="\n")
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text_clean = "\n".join(chunk for chunk in chunks if chunk)

            logger.info("HTML parsed and cleaned", file_path=self.file_path, clean_size=len(text_clean))
            yield Document(page_content=text_clean, metadata={"source": self.file_path, "page": 0})
            logger.info("HTML lazy load complete", file_path=self.file_path)

        except Exception as e:
            logger.exception("Failed to lazy load HTML", file_path=self.file_path, error=str(e))
            raise

    def load(self) -> list[Document]:
        with logger.span("Loading HTML into memory: {file_path}", file_path=self.file_path):
            docs = list(self.lazy_load())
            logger.info("HTML load complete", file_path=self.file_path, doc_count=len(docs))
            return docs


async def html_loader(file_path: str):
    with logger.span("Async HTML loader: {file_path}", file_path=file_path):
        logger.info("Initiating HTML load", file_path=file_path)
        loader = HTMLLoader(file_path=file_path)
        docs = await loader.aload()
        logger.info("Async HTML load finished", file_path=file_path, doc_count=len(docs))
        return docs
