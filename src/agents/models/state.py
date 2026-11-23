import operator
from typing import Annotated, Any, TypedDict

from langchain_core.messages import BaseMessage


class AgentState(TypedDict, total=False):
    messages: Annotated[list[BaseMessage], operator.add]
    user_message: str
    route_to: str # route on the basis of condition to (eg. respond_node or retreiver_node)
    queries: str | None
    retreived_content: list[Any] | None
    is_blocked: bool
    block_reason: str | None

    