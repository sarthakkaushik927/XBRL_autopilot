import hashlib
from pathlib import Path

# A Simple Cache Ram Variable
_KB_ETAG: str | None = None

def get_kb_etag(file_path:Path)->str:
    global _KB_ETAG
    """returns a etag for a file unique for every new file"""
    if _KB_ETAG is None:
        # extracting sha256 for the first 32 bytes this creates a unique fingerprint
        content = file_path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()[:32]
        # E_Tag is always under quates
        _KB_ETAG = f'"{digest}"'

    return _KB_ETAG



