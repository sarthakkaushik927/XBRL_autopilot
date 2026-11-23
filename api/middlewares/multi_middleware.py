import os
import uuid

from fastapi import File, Request, UploadFile

from src.constants import BASE_DIR
from src.core.logger import logger
from src.utils.main_utils import save_file

PUBLIC_DIRECTOR_NAME = str(BASE_DIR / "static")
INGESTION_FOLDER_NAME = "ingestion"
PUBLIC_TEMP_DIR = os.path.join(PUBLIC_DIRECTOR_NAME, INGESTION_FOLDER_NAME)
os.makedirs(PUBLIC_TEMP_DIR, exist_ok=True)


async def multer_middleware(
    request: Request,
    file: UploadFile = File(default=None),  # noqa: B008
):
    saved_paths: list[str] = []
    with logger.span("middleware.upload_processing"):
        try:
            if not file:
                logger.debug("middleware.upload_no_file")
                yield []
                return

            thread_id = getattr(request.state, "thread_id", None) or str(uuid.uuid4())[:8]
            dest_dir = os.path.join(PUBLIC_TEMP_DIR, str(thread_id))
            os.makedirs(dest_dir, exist_ok=True)
            file_path = os.path.join(dest_dir, file.filename)

            logger.info("middleware.upload_storing", file_name=file.filename, destination=file_path)
            content = await file.read()
            await save_file(file_path=file_path, content=content)
            saved_paths.append(file_path)
            logger.info("middleware.upload_stored", file_path=file_path)

            yield saved_paths

        finally:
            for file_path in saved_paths:
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                        logger.info("middleware.upload_cleaned", file_path=file_path)
                except OSError as clean_err:
                    logger.exception("middleware.upload_cleanup_failed", file_path=file_path, error=str(clean_err))

            if saved_paths:
                dest_dir = os.path.dirname(saved_paths[0])
                if os.path.exists(dest_dir) and not os.listdir(dest_dir):
                    os.rmdir(dest_dir)
                    logger.debug("middleware.empty_dir_cleaned", directory=dest_dir)
