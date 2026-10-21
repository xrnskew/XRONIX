"""/ai/summarize (v1, contracts/ai.md): память чата без модели — сказанное человеком, без атак и тем не про бизнес."""
from typing import Annotated, List, Literal

from pydantic import BaseModel, ConfigDict, Field

from .scope import needs_redirect


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class SummarizeRequest(BaseModel):
    memory: Annotated[str, Field(max_length=800)] = ""
    history: Annotated[List[HistoryItem], Field(max_length=30)] = []


class SummarizeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    memory: Annotated[str, Field(max_length=800)]
    tags: Annotated[List[Annotated[str, Field(min_length=1, max_length=30)]], Field(max_length=12)]


def summarize(req: SummarizeRequest) -> dict:
    said = " ".join(h.content for h in req.history if h.role == "user" and not needs_redirect(h.content))
    old = req.memory if not needs_redirect(req.memory) else ""
    memory = f"{old} {said}".strip()[:800]
    return SummarizeResponse(memory=memory, tags=[]).model_dump()
