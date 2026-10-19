"""Вход и выход сервиса по contracts/schemas: ai-request, reply (без plan_id), summarize."""
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .plan import Plan


# ---------- вход ----------

class Profile(BaseModel):
    name: str
    city: Optional[str] = None
    experience: Optional[str] = None
    budget_rub: Optional[Annotated[int, Field(ge=0)]] = None


class UserContext(BaseModel):
    profile: Profile
    tags: Annotated[List[str], Field(max_length=12)] = []
    memory: Annotated[str, Field(max_length=800)] = ""


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class RespondRequest(BaseModel):
    mode: Literal["chat"]
    user_context: UserContext
    history: Annotated[List[HistoryItem], Field(max_length=10)] = []
    message: Annotated[str, Field(min_length=1, max_length=4000)]


class SummarizeRequest(BaseModel):
    memory: Annotated[str, Field(max_length=800)] = ""
    history: Annotated[List[HistoryItem], Field(max_length=30)] = []


# ---------- выход ----------

class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MessageReply(_Out):
    type: Literal["message"] = "message"
    text: Annotated[str, Field(min_length=1, max_length=2000)]


class Question(_Out):
    id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,30}$")]
    text: Annotated[str, Field(min_length=1, max_length=200)]
    kind: Literal["choice", "text"]
    options: Optional[Annotated[List[Annotated[str, Field(min_length=1, max_length=40)]], Field(min_length=2, max_length=5)]] = None

    @model_validator(mode="after")
    def _options_only_for_choice(self):
        if (self.kind == "choice") != (self.options is not None):
            raise ValueError("options обязательны для choice и запрещены для text")
        return self


class QuestionsReply(_Out):
    type: Literal["questions"] = "questions"
    text: Annotated[str, Field(min_length=1, max_length=300)]
    # Схема разрешает 1–6, но бэк отклоняет меньше 3 (contracts/ai.md).
    questions: Annotated[List[Question], Field(min_length=3, max_length=6)]


class PlanReply(_Out):
    type: Literal["plan"] = "plan"
    text: Annotated[str, Field(min_length=1, max_length=300)]
    plan: Plan


class SummarizeResponse(_Out):
    memory: Annotated[str, Field(max_length=800)]
    tags: Annotated[List[Annotated[str, Field(min_length=1, max_length=30)]], Field(max_length=12)]


# ---------- что просим у GigaChat на шаге «решить, что ответить» ----------
# Нарочно мягче контракта: длины и id чистим кодом (service.clean_questions),
# чтобы из-за лишнего символа не терять весь ответ.

# Пустые поля модель часто просто не пишет (нет options у text, нет questions у message),
# поэтому у них значения по умолчанию.
class QuestionDraft(BaseModel):
    id: str = ""
    text: str
    kind: Literal["choice", "text"] = "text"
    options: List[str] = []


class Decision(BaseModel):
    action: Literal["questions", "plan", "message"]
    text: str = ""
    questions: List[QuestionDraft] = []
