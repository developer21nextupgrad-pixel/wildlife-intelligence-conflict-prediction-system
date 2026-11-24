"""Authentication, session verification, and admin user management endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
import logging
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import (
    AuthenticatedPrincipal,
    create_access_token,
    get_current_principal,
    hash_password,
    require_roles,
    verify_password,
)
from app.models.user import UserAccount
from app.schemas.common import NonEmptyStr

logger = logging.getLogger("wicps.auth")

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])

RoleLiteral = Literal["operator", "reviewer", "admin"]


class AuthStatusResponse(BaseModel):
    auth_enabled: bool
    password_login_enabled: bool
    oidc_enabled: bool
    oidc_issuer: str | None = None
    needs_initial_setup: bool = False


class LoginRequest(BaseModel):
    identifier: NonEmptyStr = Field(..., max_length=255)
    password: str = Field(..., min_length=1, max_length=256)


class BootstrapAdminRequest(BaseModel):
    email: NonEmptyStr = Field(..., max_length=255)
    display_name: NonEmptyStr = Field(..., max_length=160)
    password: str = Field(..., min_length=8, max_length=256)


class AuthenticatedUserProfile(BaseModel):
    id: str | None = None
    subject: str
    email: str | None = None
    display_name: str
    role: str
    roles: list[str]
    effective_roles: list[str]
    auth_method: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: AuthenticatedUserProfile


class UserAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    username: str
    display_name: str
    role: str
    is_active: bool
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class UserAccountCreateRequest(BaseModel):
    email: NonEmptyStr = Field(..., max_length=255)
    username: NonEmptyStr | None = Field(default=None, max_length=80)
    display_name: NonEmptyStr = Field(..., max_length=160)
    role: RoleLiteral = "operator"
    password: str = Field(..., min_length=8, max_length=256)


class UserAccountUpdateRequest(BaseModel):
    display_name: NonEmptyStr | None = Field(default=None, max_length=160)
    role: RoleLiteral | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)


@router.get("/status", response_model=AuthStatusResponse)
def get_auth_status(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AuthStatusResponse:
    needs_setup = False
    if not settings.is_production:
        user_count = int(db.execute(select(func.count(UserAccount.id))).scalar_one() or 0)
        needs_setup = user_count == 0
    return AuthStatusResponse(
        auth_enabled=settings.auth_enabled,
        password_login_enabled=bool(settings.auth_jwt_secret),
        oidc_enabled=bool(settings.auth_oidc_jwks_url),
        oidc_issuer=settings.auth_oidc_issuer if settings.auth_oidc_jwks_url else None,
        needs_initial_setup=needs_setup,
    )


@router.post(
    "/bootstrap-admin",
    response_model=LoginResponse,
    status_code=status.HTTP_201_CREATED,
)
def bootstrap_initial_admin(
    payload: BootstrapAdminRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    """Non-production initial setup endpoint enabled strictly when zero users exist."""
    if settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self-service admin bootstrap is disabled in production. Configure AUTH_BOOTSTRAP_ADMIN_* or CLI.",
        )

    existing_count = int(db.execute(select(func.count(UserAccount.id))).scalar_one() or 0)
    if existing_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Initial administrator already configured. Sign in with existing credentials.",
        )

    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid administrator email address.",
        )
    username = email.split("@", 1)[0][:80] or "admin"
    account = UserAccount(
        email=email,
        username=username,
        display_name=payload.display_name.strip(),
        role="admin",
        password_hash=hash_password(payload.password),
        is_active=True,
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    token = create_access_token(
        subject=str(account.id),
        email=account.email,
        display_name=account.display_name,
        role=account.role,
        user_id=account.id,
        settings=settings,
    )
    return LoginResponse(
        access_token=token,
        expires_in=settings.auth_jwt_expire_minutes * 60,
        user=AuthenticatedUserProfile(
            id=str(account.id),
            subject=str(account.id),
            email=account.email,
            display_name=account.display_name,
            role=account.role,
            roles=[account.role],
            effective_roles=["admin", "reviewer", "operator"],
            auth_method="jwt_hs256",
        ),
    )


@router.post("/login", response_model=LoginResponse)
def login_with_credentials(
    payload: LoginRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> LoginResponse:
    if not settings.auth_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Local password login is disabled; authenticate with your configured OIDC identity provider.",
        )

    ident = payload.identifier.strip().lower()
    user = db.execute(
        select(UserAccount).where(
            or_(
                func.lower(UserAccount.email) == ident,
                func.lower(UserAccount.username) == ident,
            )
        )
    ).scalar_one_or_none()

    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email/username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated. Contact your division administrator.",
        )

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    token = create_access_token(
        subject=str(user.id),
        email=user.email,
        display_name=user.display_name,
        role=user.role,
        user_id=user.id,
        settings=settings,
    )
    from app.core.security import expand_effective_roles

    return LoginResponse(
        access_token=token,
        expires_in=settings.auth_jwt_expire_minutes * 60,
        user=AuthenticatedUserProfile(
            id=str(user.id),
            subject=str(user.id),
            email=user.email,
            display_name=user.display_name,
            role=user.role,
            roles=[user.role],
            effective_roles=sorted(expand_effective_roles([user.role])),
            auth_method="jwt_hs256",
        ),
    )


@router.get("/me", response_model=AuthenticatedUserProfile)
def get_authenticated_profile(
    principal: AuthenticatedPrincipal = Depends(get_current_principal),
) -> AuthenticatedUserProfile:
    return AuthenticatedUserProfile(
        id=str(principal.user_id) if principal.user_id else None,
        subject=principal.subject,
        email=principal.email,
        display_name=principal.display_name,
        role=principal.primary_role,
        roles=sorted(principal.roles),
        effective_roles=sorted(principal.effective_roles),
        auth_method=principal.auth_method,
    )


@router.get("/users", response_model=list[UserAccountResponse])
def list_user_accounts(
    db: Session = Depends(get_db),
    _admin: AuthenticatedPrincipal = Depends(require_roles("admin")),
) -> list[UserAccountResponse]:
    rows = db.execute(select(UserAccount).order_by(UserAccount.created_at.asc())).scalars().all()
    return [UserAccountResponse.model_validate(row) for row in rows]


@router.post(
    "/users",
    response_model=UserAccountResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user_account(
    payload: UserAccountCreateRequest,
    db: Session = Depends(get_db),
    _admin: AuthenticatedPrincipal = Depends(require_roles("admin")),
) -> UserAccountResponse:
    email = payload.email.strip().lower()
    if "@" not in email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Valid email address is required.",
        )
    username = (payload.username or email.split("@", 1)[0]).strip()[:80]
    conflict = db.execute(
        select(UserAccount).where(
            or_(
                func.lower(UserAccount.email) == email,
                func.lower(UserAccount.username) == username.lower(),
            )
        )
    ).scalar_one_or_none()
    if conflict is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email or username already exists.",
        )

    account = UserAccount(
        email=email,
        username=username,
        display_name=payload.display_name.strip(),
        role=payload.role,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    logger.info("Admin created user email=%s role=%s", account.email, account.role)
    return UserAccountResponse.model_validate(account)


@router.patch("/users/{user_id}", response_model=UserAccountResponse)
def update_user_account(
    user_id: uuid.UUID,
    payload: UserAccountUpdateRequest,
    db: Session = Depends(get_db),
    _admin: AuthenticatedPrincipal = Depends(require_roles("admin")),
) -> UserAccountResponse:
    account = db.get(UserAccount, user_id)
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if payload.display_name is not None:
        account.display_name = payload.display_name.strip()
    if payload.role is not None:
        account.role = payload.role
    if payload.is_active is not None:
        account.is_active = payload.is_active
    if payload.password is not None:
        account.password_hash = hash_password(payload.password)

    db.commit()
    db.refresh(account)
    return UserAccountResponse.model_validate(account)
