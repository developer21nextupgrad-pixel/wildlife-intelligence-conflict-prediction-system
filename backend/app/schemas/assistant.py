"""Pydantic request/response schemas for the AI Wildlife Intelligence Assistant."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class AssistantHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def strip_content(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Message content cannot be blank.")
        return cleaned


class AssistantChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[AssistantHistoryMessage] = Field(default_factory=list, max_length=20)
    active_district: str | None = Field(default=None, max_length=120)
    active_date_range: str | None = Field(default=None, max_length=64)

    @field_validator("message")
    @classmethod
    def strip_message(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Please enter a question for the AI Wildlife Intelligence Assistant.")
        return cleaned


class AssistantMapLocation(BaseModel):
    id: str
    label: str
    kind: Literal["village", "risk_zone", "incident", "sighting", "alert", "patrol"]
    latitude: float
    longitude: float
    district: str | None = None
    risk_level: str | None = None
    risk_score: int | None = None
    subtitle: str | None = None


class AssistantSourceRecord(BaseModel):
    tool: str
    label: str
    record_count: int = 0


class AssistantChatResponse(BaseModel):
    reply: str
    model: str
    tools_used: list[str] = Field(default_factory=list)
    sources: list[AssistantSourceRecord] = Field(default_factory=list)
    map_locations: list[AssistantMapLocation] = Field(default_factory=list)
    generated_at: datetime
    read_only: bool = True


class AssistantStatusResponse(BaseModel):
    configured: bool
    model: str
    read_only: bool = True
    available_tools: list[str] = Field(default_factory=list)
    message: str | None = None
