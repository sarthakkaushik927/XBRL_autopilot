"""Check a generated Ind AS instance with a real XBRL processor (Arelle, dev extra), offline.

Our validator (`IndASValidator`) only knows the rules we coded. Arelle loads the official Ind AS 2017 taxonomy
from `data/` and checks the instance itself: XBRL 2.1 (schema types, contexts, units), XBRL Dimensions (every
fact's dimensions must be allowed by the taxonomy's hypercubes) and the calculation linkbase.

The instance's schemaRef is the MCA address (no internet needed): a copy is checked with the schemaRef pointing at
the local entry point. Usage:  uv run python -m tests.xbrl_conformance <instance.xml>
"""
from __future__ import annotations

import logging
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
LOCAL_ENTRY_POINT = ROOT / "data" / "IND-AS taxonomy" / "Taxonomy for IND-AS V1.2@31-03-2017" / "Ind AS taxonomy" / "Ind AS taxonomy" / "in-ci-ent-2017-03-31.xsd"
_SCHEMA_REF = re.compile(r'(<link:schemaRef\b[^>]*xlink:href=")[^"]*(")')


@dataclass(frozen=True)
class Problem:
    level: str
    code: str
    message: str

    def __str__(self) -> str:
        return f"{self.level} [{self.code}] {self.message}"


class _Collect(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.INFO)
        self.problems: list[Problem] = []

    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno >= logging.WARNING:
            self.problems.append(Problem(record.levelname, str(getattr(record, "messageCode", "") or ""), record.getMessage()))


def arelle_available() -> bool:
    try:
        import arelle  # noqa: F401
    except ImportError:
        return False
    return LOCAL_ENTRY_POINT.exists()


def check_instance(xml: str) -> list[Problem]:
    """Every WARNING / ERROR Arelle reports for the instance (empty = valid)."""
    from arelle.api.Session import Session
    from arelle.RuntimeOptions import RuntimeOptions

    # a relative, URL-encoded href from a folder on the repository's drive (Arelle misreads Windows file: URIs)
    (ROOT / "output").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ROOT / "output") as tmp:
        href = quote(os.path.relpath(LOCAL_ENTRY_POINT, tmp).replace(os.sep, "/"))
        local = _SCHEMA_REF.sub(lambda m: f"{m.group(1)}{href}{m.group(2)}", xml, count=1)
        path = Path(tmp) / "instance.xml"
        path.write_text(local, encoding="utf-8")
        handler = _Collect()
        options = RuntimeOptions(entrypointFile=str(path), validate=True, internetConnectivity="offline", calcs="c10", logFile="logToBuffer")
        with Session() as session:
            session.run(options, logHandler=handler)
        return handler.problems


if __name__ == "__main__":
    found = check_instance(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for p in found:
        print(p)
    print(f"{len(found)} problem(s)")
    sys.exit(1 if found else 0)
