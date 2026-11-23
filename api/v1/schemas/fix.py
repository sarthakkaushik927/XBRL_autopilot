from pydantic import BaseModel


class FixRequest(BaseModel):
    """Stub schema for fix requests while fix-agent is temporarily removed."""
    model_config = {"extra": "allow"}
