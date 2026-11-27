"""Authenticated, read-only FastAPI endpoints for the AI Wildlife Intelligence Assistant."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import AuthenticatedPrincipal, get_current_principal
from app.schemas.assistant import (
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantStatusResponse,
)
from app.services.gemini_assistant import (
    AssistantServiceError,
    GeminiAssistantService,
    get_assistant_service,
)

router = APIRouter(prefix="/assistant", tags=["AI Wildlife Intelligence Assistant"])


def _get_assistant_service_dep(
    settings: Settings = Depends(get_settings),
) -> GeminiAssistantService:
    return get_assistant_service(settings)


@router.get("/status", response_model=AssistantStatusResponse)
def get_assistant_status(
    _principal: AuthenticatedPrincipal = Depends(get_current_principal),
    assistant_service: GeminiAssistantService = Depends(_get_assistant_service_dep),
) -> AssistantStatusResponse:
    """Returns server-side Gemini readiness and available read-only tools without exposing API keys."""
    return AssistantStatusResponse(**assistant_service.get_status())


@router.post("/chat", response_model=AssistantChatResponse)
def chat_with_wildlife_assistant(
    payload: AssistantChatRequest,
    db: Session = Depends(get_db),
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
    assistant_service: GeminiAssistantService = Depends(_get_assistant_service_dep),
) -> AssistantChatResponse:
    """Answers natural-language wildlife intelligence questions grounded in live WICPS database records."""
    try:
        return assistant_service.chat(
            db=db,
            principal=principal,
            message=payload.message,
            history=payload.history,
            active_district=payload.active_district,
            active_date_range=payload.active_date_range,
        )
    except AssistantServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
