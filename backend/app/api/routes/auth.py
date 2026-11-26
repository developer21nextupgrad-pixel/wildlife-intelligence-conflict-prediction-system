"""Authentication, session verification, and admin user management endpoints."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import logging
import re
import secrets
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.security import (
    AuthenticatedPrincipal,
    create_access_token,
    get_current_principal,
    get_optional_principal,
    hash_password,
    require_roles,
    verify_password,
)
from app.models.user import PasswordResetToken, UserAccount
from app.schemas.common import NonEmptyStr
from app.services.email_service import (
    SmtpEmailService,
    build_password_reset_url,
    get_email_service,
)

logger = logging.getLogger("wicps.auth")

router = APIRouter(prefix="/auth", tags=["Authentication & RBAC"])

RoleLiteral = Literal["operator", "reviewer", "admin"]

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_USERNAME_SANITIZE_RE = re.compile(r"[^a-z0-9._-]+")


def _validate_email_format(raw_email: str) -> str:
    email = (raw_email or "").strip().lower()
    if len(email) > 255 or not _EMAIL_RE.match(email):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please enter a valid email address.",
        )
    return email


def _validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must be at least 8 characters long.",
        )
    if len(password) > 256:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Password must not exceed 256 characters.",
        )


def _hash_reset_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _normalize_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _get_email_service_dep(settings: Settings = Depends(get_settings)) -> SmtpEmailService:
    return get_email_service(settings)


def _generate_unique_username(db: Session, email: str) -> str:
    local_part = email.split("@", 1)[0].lower()
    base = _USERNAME_SANITIZE_RE.sub("", local_part)[:64] or "user"
    candidate = base
    for _ in range(10):
        conflict = db.execute(
            select(UserAccount.id).where(func.lower(UserAccount.username) == candidate.lower())
        ).scalar_one_or_none()
        if conflict is None:
            return candidate
        candidate = f"{base[:56]}-{secrets.token_hex(3)}"
    return f"user-{uuid.uuid4().hex[:12]}"


class AuthenticatedUserProfile(BaseModel):
    id: str | None = None
    subject: str
    email: str | None = None
    display_name: str
    role: str
    roles: list[str]
    effective_roles: list[str]
    auth_method: str


class AuthStatusResponse(BaseModel):
    authenticated: bool = False
    user: AuthenticatedUserProfile | None = None
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


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: NonEmptyStr = Field(..., min_length=2, max_length=160)
    email: NonEmptyStr = Field(..., max_length=255)
    password: str = Field(..., min_length=8, max_length=256)
    confirm_password: str = Field(..., min_length=8, max_length=256)

    @model_validator(mode="after")
    def verify_passwords_match(self) -> "RegisterRequest":
        if self.password != self.confirm_password:
            raise ValueError("Password and confirm password do not match.")
        return self


class RegisterResponse(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    display_name: str
    role: str
    is_active: bool
    requires_approval: bool
    message: str


class ForgotPasswordRequest(BaseModel):
    email: NonEmptyStr = Field(..., max_length=255)


class ForgotPasswordResponse(BaseModel):
    status: str = "accepted"
    message: str


class ValidateResetTokenRequest(BaseModel):
    token: NonEmptyStr = Field(..., min_length=16, max_length=512)


class ValidateResetTokenResponse(BaseModel):
    valid: bool
    expires_at: datetime | None = None
    detail: str | None = None


class ResetPasswordRequest(BaseModel):
    token: NonEmptyStr = Field(..., min_length=16, max_length=512)
    new_password: str = Field(..., min_length=8, max_length=256)
    confirm_password: str = Field(..., min_length=8, max_length=256)

    @model_validator(mode="after")
    def verify_passwords_match(self) -> "ResetPasswordRequest":
        if self.new_password != self.confirm_password:
            raise ValueError("New password and confirm password do not match.")
        return self


class ResetPasswordResponse(BaseModel):
    status: str = "ok"
    message: str


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
    principal: AuthenticatedPrincipal | None = Depends(get_optional_principal),
) -> AuthStatusResponse:
    needs_setup = False
    if not settings.is_production:
        user_count = int(db.execute(select(func.count(UserAccount.id))).scalar_one() or 0)
        needs_setup = user_count == 0

    safe_user: AuthenticatedUserProfile | None = None
    if principal is not None:
        is_valid_account = True
        if principal.user_id is not None:
            account = db.get(UserAccount, principal.user_id)
            if account is None or not account.is_active:
                is_valid_account = False
        if is_valid_account:
            safe_user = AuthenticatedUserProfile(
                id=str(principal.user_id) if principal.user_id else None,
                subject=principal.subject,
                email=principal.email,
                display_name=principal.display_name,
                role=principal.primary_role,
                roles=sorted(principal.roles),
                effective_roles=sorted(principal.effective_roles),
                auth_method=principal.auth_method,
            )

    return AuthStatusResponse(
        authenticated=safe_user is not None,
        user=safe_user,
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
            detail="User account is deactivated or awaiting administrator approval. Contact your division administrator.",
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


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
def register_account(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> RegisterResponse:
    """Public self-registration endpoint. Always assigns least-privilege 'operator' role (never admin)."""
    if not settings.auth_jwt_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Local account registration is disabled when OIDC-only authentication is enforced.",
        )

    email = _validate_email_format(payload.email)
    _validate_password_strength(payload.password)

    existing = db.execute(
        select(UserAccount.id).where(func.lower(UserAccount.email) == email)
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address is already registered.",
        )

    username = _generate_unique_username(db, email)
    requires_approval = bool(settings.auth_require_admin_approval)

    # Security invariant: public registration strictly assigns the lowest-privilege 'operator' role.
    account = UserAccount(
        email=email,
        username=username,
        display_name=payload.full_name.strip(),
        role="operator",
        password_hash=hash_password(payload.password),
        is_active=not requires_approval,
    )
    db.add(account)
    db.commit()
    db.refresh(account)

    logger.info(
        "Registered new operator account user_id=%s requires_approval=%s",
        account.id,
        requires_approval,
    )
    message = (
        "Account created successfully and is pending administrator approval before sign-in."
        if requires_approval
        else "Account created successfully with Operator access. You can now sign in."
    )
    return RegisterResponse(
        id=account.id,
        email=account.email,
        username=account.username,
        display_name=account.display_name,
        role=account.role,
        is_active=account.is_active,
        requires_approval=requires_approval,
        message=message,
    )


_GENERIC_FORGOT_PASSWORD_MESSAGE = (
    "If an active account is registered with that email address, a password reset link has been sent."
)


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
def request_password_reset(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    email_service: SmtpEmailService = Depends(_get_email_service_dep),
) -> ForgotPasswordResponse:
    """Generates a single-use hashed reset token and sends a recovery email without leaking account existence."""
    email = _validate_email_format(payload.email)
    user = db.execute(
        select(UserAccount).where(func.lower(UserAccount.email) == email)
    ).scalar_one_or_none()

    if user is None or not user.is_active:
        return ForgotPasswordResponse(
            status="accepted",
            message=_GENERIC_FORGOT_PASSWORD_MESSAGE,
        )

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.password_reset_token_expire_minutes)
    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_reset_token(raw_token)

    forwarded_for = request.headers.get("x-forwarded-for")
    client_ip = (
        forwarded_for.split(",")[0].strip()
        if forwarded_for
        else (request.client.host if request.client else None)
    )

    try:
        # Invalidate any prior unused reset tokens for this user
        db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now)
        )
        token_record = PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
            requested_ip=(client_ip or "")[:64] or None,
        )
        db.add(token_record)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to persist password reset token for user_id=%s", user.id)
        return ForgotPasswordResponse(
            status="accepted",
            message=_GENERIC_FORGOT_PASSWORD_MESSAGE,
        )

    reset_url = build_password_reset_url(settings.frontend_base_url, raw_token)
    email_service.send_password_reset_email(
        to_email=user.email,
        display_name=user.display_name,
        reset_url=reset_url,
        expire_minutes=settings.password_reset_token_expire_minutes,
    )

    return ForgotPasswordResponse(
        status="accepted",
        message=_GENERIC_FORGOT_PASSWORD_MESSAGE,
    )


@router.post("/reset-password/validate", response_model=ValidateResetTokenResponse)
def validate_password_reset_token(
    payload: ValidateResetTokenRequest,
    db: Session = Depends(get_db),
) -> ValidateResetTokenResponse:
    """Checks whether a password reset token is valid, unused, and unexpired."""
    token_hash = _hash_reset_token(payload.token.strip())
    token_record = db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if (
        token_record is None
        or token_record.used_at is not None
        or _normalize_utc(token_record.expires_at) <= now
    ):
        return ValidateResetTokenResponse(
            valid=False,
            detail="This password reset link is invalid, expired, or has already been used.",
        )

    user = db.get(UserAccount, token_record.user_id)
    if user is None or not user.is_active:
        return ValidateResetTokenResponse(
            valid=False,
            detail="This password reset link is no longer valid.",
        )

    return ValidateResetTokenResponse(
        valid=True,
        expires_at=_normalize_utc(token_record.expires_at),
    )


@router.post("/reset-password", response_model=ResetPasswordResponse)
def reset_password_with_token(
    payload: ResetPasswordRequest,
    db: Session = Depends(get_db),
) -> ResetPasswordResponse:
    """Validates a single-use reset token, updates the user's password hash, and invalidates the token."""
    _validate_password_strength(payload.new_password)

    token_hash = _hash_reset_token(payload.token.strip())
    token_record = db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash)
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if (
        token_record is None
        or token_record.used_at is not None
        or _normalize_utc(token_record.expires_at) <= now
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid, expired, or has already been used.",
        )

    user = db.get(UserAccount, token_record.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is no longer valid.",
        )

    try:
        # Atomically claim the single-use token to prevent concurrent replay
        claim_res = db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.id == token_record.id,
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now)
        )
        if claim_res.rowcount != 1:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This password reset link has already been used.",
            )

        user.password_hash = hash_password(payload.new_password)
        # Invalidate any other outstanding reset tokens for this user
        db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=now)
        )
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Password reset transaction failed for user_id=%s", user.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to update password right now. Please try again.",
        )

    logger.info("Password updated via reset token for user_id=%s", user.id)
    return ResetPasswordResponse(
        status="ok",
        message="Your password has been reset successfully. You can now sign in with your new password.",
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
