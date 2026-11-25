"""JWT/OIDC Authentication, PBKDF2 password hashing, and Role-Based Access Control (RBAC)."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
import hashlib
import hmac
import logging
import secrets
from typing import Any, Callable
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt
from jwt import InvalidTokenError, PyJWKClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models.user import UserAccount

logger = logging.getLogger("wicps.security")

VALID_ROLES: tuple[str, ...] = ("operator", "reviewer", "admin")

_ROLE_EXPANSION: dict[str, set[str]] = {
    "operator": {"operator"},
    "reviewer": {"reviewer", "operator"},
    "admin": {"admin", "reviewer", "operator"},
}

_PBKDF2_ITERATIONS = 310_000
_OIDC_ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"]

_bearer_scheme = HTTPBearer(auto_error=False)


def expand_effective_roles(roles: set[str] | list[str] | tuple[str, ...]) -> set[str]:
    expanded: set[str] = set()
    for role in roles:
        norm = str(role or "").strip().lower()
        expanded.update(_ROLE_EXPANSION.get(norm, set()))
    return expanded


def hash_password(raw_password: str) -> str:
    if not raw_password or len(raw_password) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        raw_password.encode("utf-8"),
        salt,
        _PBKDF2_ITERATIONS,
    )
    salt_b64 = base64.urlsafe_b64encode(salt).decode("ascii")
    digest_b64 = base64.urlsafe_b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt_b64}${digest_b64}"


def verify_password(raw_password: str, stored_hash: str) -> bool:
    if not raw_password or not stored_hash:
        return False
    try:
        scheme, iter_raw, salt_b64, digest_b64 = stored_hash.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        iterations = int(iter_raw)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    computed = hashlib.pbkdf2_hmac(
        "sha256",
        raw_password.encode("utf-8"),
        salt,
        iterations,
    )
    return hmac.compare_digest(computed, expected)


@dataclass(frozen=True)
class AuthenticatedPrincipal:
    subject: str
    email: str | None
    display_name: str
    roles: frozenset[str]
    auth_method: str
    user_id: uuid.UUID | None = None

    @property
    def effective_roles(self) -> set[str]:
        return expand_effective_roles(self.roles)

    @property
    def primary_role(self) -> str:
        for role in ("admin", "reviewer", "operator"):
            if role in self.roles:
                return role
        return "operator"

    @property
    def audit_label(self) -> str:
        name = (self.display_name or "").strip()
        email = (self.email or "").strip()
        if name and email and email.lower() not in name.lower():
            return f"{name} ({email})"[:160]
        return (name or email or self.subject)[:160]


@lru_cache(maxsize=8)
def _get_jwk_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url, cache_jwk_set=True, lifespan=300, timeout=10)


def _extract_claim_path(claims: dict[str, Any], path: str) -> Any:
    current: Any = claims
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _extract_roles_from_claims(claims: dict[str, Any], role_claim: str) -> set[str]:
    candidates: list[Any] = []
    if role_claim:
        candidates.append(_extract_claim_path(claims, role_claim))
    for fallback_key in ("roles", "role", "wicps_roles", "realm_access.roles"):
        if fallback_key != role_claim:
            candidates.append(_extract_claim_path(claims, fallback_key))

    parsed: set[str] = set()
    for val in candidates:
        if val is None:
            continue
        if isinstance(val, str):
            for part in val.replace(",", " ").split():
                norm = part.strip().lower()
                if norm in VALID_ROLES:
                    parsed.add(norm)
        elif isinstance(val, (list, tuple, set)):
            for item in val:
                norm = str(item or "").strip().lower()
                if norm in VALID_ROLES:
                    parsed.add(norm)
    return parsed


def create_access_token(
    *,
    subject: str,
    email: str | None,
    display_name: str,
    role: str,
    settings: Settings,
    user_id: uuid.UUID | None = None,
    expires_delta: timedelta | None = None,
) -> str:
    if not settings.auth_jwt_secret:
        raise RuntimeError("AUTH_JWT_SECRET is not configured for signing tokens.")
    norm_role = role.strip().lower()
    if norm_role not in VALID_ROLES:
        raise ValueError(f"Unsupported role '{role}'.")

    now = datetime.now(timezone.utc)
    exp = now + (expires_delta or timedelta(minutes=settings.auth_jwt_expire_minutes))
    payload: dict[str, Any] = {
        "sub": subject,
        "email": email,
        "name": display_name,
        "role": norm_role,
        "roles": [norm_role],
        "iss": settings.auth_jwt_issuer,
        "aud": settings.auth_jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    if user_id is not None:
        payload["uid"] = str(user_id)
    return jwt.encode(payload, settings.auth_jwt_secret, algorithm="HS256")


def decode_and_verify_token(token: str, settings: Settings) -> AuthenticatedPrincipal:
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token format.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    alg = str(header.get("alg") or "").upper()
    if not alg or alg == "NONE":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unsupported JWT signing algorithm.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims: dict[str, Any]
    auth_method: str

    if alg == "HS256":
        if not settings.auth_jwt_secret:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="HS256 JWT verification is not configured on this server.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            claims = jwt.decode(
                token,
                settings.auth_jwt_secret,
                algorithms=["HS256"],
                audience=settings.auth_jwt_audience,
                issuer=settings.auth_jwt_issuer,
                options={"require": ["exp", "sub"]},
            )
            auth_method = "jwt_hs256"
        except InvalidTokenError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired authentication token.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc

    elif alg in _OIDC_ALLOWED_ALGORITHMS:
        if not settings.auth_oidc_jwks_url:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="OIDC JWKS verification is not configured on this server.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        try:
            jwk_client = _get_jwk_client(settings.auth_oidc_jwks_url)
            signing_key = jwk_client.get_signing_key_from_jwt(token)
            decode_kwargs: dict[str, Any] = {
                "algorithms": _OIDC_ALLOWED_ALGORITHMS,
                "options": {
                    "require": ["exp", "sub"],
                    "verify_aud": bool(settings.auth_oidc_audience),
                    "verify_iss": bool(settings.auth_oidc_issuer),
                },
            }
            if settings.auth_oidc_audience:
                decode_kwargs["audience"] = settings.auth_oidc_audience
            if settings.auth_oidc_issuer:
                decode_kwargs["issuer"] = settings.auth_oidc_issuer

            claims = jwt.decode(token, signing_key.key, **decode_kwargs)
            auth_method = "oidc_jwks"
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired OIDC token.",
                headers={"WWW-Authenticate": "Bearer"},
            ) from exc
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unsupported JWT signing algorithm.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    subject = str(claims.get("sub") or "").strip()
    if not subject:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing required 'sub' claim.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    roles = _extract_roles_from_claims(claims, settings.auth_role_claim)
    if not roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authenticated token does not carry an authorized WICPS role (operator, reviewer, or admin).",
        )

    email = str(claims.get("email")).strip() if claims.get("email") else None
    display_name = str(
        claims.get("name")
        or claims.get("preferred_username")
        or email
        or subject
    ).strip()

    uid: uuid.UUID | None = None
    raw_uid = claims.get("uid")
    if raw_uid:
        try:
            uid = uuid.UUID(str(raw_uid))
        except ValueError:
            uid = None

    return AuthenticatedPrincipal(
        subject=subject,
        email=email,
        display_name=display_name,
        roles=frozenset(roles),
        auth_method=auth_method,
        user_id=uid,
    )


def get_current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedPrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer" or not credentials.credentials.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Provide a valid Bearer JWT token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_and_verify_token(credentials.credentials.strip(), settings)


def get_optional_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedPrincipal | None:
    """Optionally verifies a Bearer JWT without raising 401 when missing, malformed, or expired."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    raw_token = credentials.credentials.strip()
    if not raw_token:
        return None
    try:
        return decode_and_verify_token(raw_token, settings)
    except HTTPException:
        return None


def require_roles(*allowed_roles: str) -> Callable[..., AuthenticatedPrincipal]:
    required = {r.strip().lower() for r in allowed_roles if r.strip()}

    def _dependency(
        principal: AuthenticatedPrincipal = Depends(get_current_principal),
    ) -> AuthenticatedPrincipal:
        if not required:
            return principal
        if not (principal.effective_roles & required):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required role: {', '.join(sorted(required))}.",
            )
        return principal

    return _dependency


def require_non_production(settings: Settings = Depends(get_settings)) -> None:
    if settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Development and test endpoints are disabled in production.",
        )


def bootstrap_admin_from_env(db: Session, settings: Settings) -> UserAccount | None:
    """Creates or updates the configured bootstrap admin account from environment variables."""
    email = (settings.auth_bootstrap_admin_email or "").strip().lower()
    password = settings.auth_bootstrap_admin_password
    if not email or not password:
        return None

    existing = db.execute(
        select(UserAccount).where(func.lower(UserAccount.email) == email)
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    username = email.split("@", 1)[0][:80] or "admin"
    username_conflict = db.execute(
        select(UserAccount).where(func.lower(UserAccount.username) == username.lower())
    ).scalar_one_or_none()
    if username_conflict is not None:
        username = f"{username[:68]}-{uuid.uuid4().hex[:6]}"

    account = UserAccount(
        email=email,
        username=username,
        display_name=settings.auth_bootstrap_admin_name.strip() or "Division Administrator",
        role="admin",
        password_hash=hash_password(password),
        is_active=True,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    logger.info("Bootstrapped admin account from environment for email=%s", email)
    return account
