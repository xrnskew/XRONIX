"""Вход и выход /ai/consult и /ai/parse-need по contracts/schemas/consult.schema.json и parse-need.schema.json."""
from typing import Annotated, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

Sphere = Literal["coffee", "bakery", "car_wash", "clothing_store", "beauty_salon", "pickup_point", "other"]
Purpose = Literal["working_capital", "equipment", "new_location", "new_direction", "real_estate", "refinance"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ConsultState(_Strict):
    sphere: Optional[Sphere]
    city: Optional[Annotated[str, Field(max_length=60)]]
    own_funds_rub: Optional[Annotated[int, Field(ge=0)]]
    answers: Dict[str, Union[int, float, str]]


class HistoryItem(_Strict):
    role: Literal["user", "assistant"]
    content: Annotated[str, Field(max_length=4000)]


class ConsultRequest(_Strict):
    history: Annotated[List[HistoryItem], Field(max_length=20)]
    message: Annotated[str, Field(min_length=1, max_length=4000)]
    state: ConsultState


class Question(_Strict):
    id: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,30}$")]
    text: Annotated[str, Field(min_length=1, max_length=200)]
    kind: Literal["choice", "text"]
    options: Optional[Annotated[List[Annotated[str, Field(min_length=1, max_length=40)]], Field(min_length=2, max_length=5)]] = None

    @model_validator(mode="after")
    def _options(self):
        if (self.kind == "choice") != (self.options is not None):
            raise ValueError("options обязательны для choice и запрещены для text")
        return self


class ConsultResponse(_Strict):
    type: Literal["questions", "message", "ready"]
    text: Annotated[str, Field(min_length=1, max_length=600)]
    questions: Optional[Annotated[List[Question], Field(min_length=1, max_length=4)]] = None
    state: ConsultState

    @model_validator(mode="after")
    def _questions(self):
        if (self.type == "questions") != (self.questions is not None):
            raise ValueError("questions есть только при type=questions")
        return self


class ParseNeedRequest(_Strict):
    text: Annotated[str, Field(min_length=1, max_length=2000)]


Conf = Annotated[float, Field(ge=0, le=1)]


class Confidence(_Strict):
    purpose: Optional[Conf] = None
    sphere: Optional[Conf] = None
    city: Optional[Conf] = None
    amount_rub: Optional[Conf] = None
    term_months: Optional[Conf] = None
    has_collateral: Optional[Conf] = None


class ParseNeedResponse(_Strict):
    purpose: Optional[Purpose]
    sphere: Optional[Sphere]
    city: Optional[Annotated[str, Field(max_length=60)]]
    amount_rub: Optional[Annotated[int, Field(ge=1000, le=1_000_000_000)]]
    term_months: Optional[Annotated[int, Field(ge=1, le=360)]]
    has_collateral: Optional[bool]
    confidence: Confidence
