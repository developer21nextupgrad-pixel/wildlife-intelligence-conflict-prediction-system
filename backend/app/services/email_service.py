"""SMTP email delivery service for WICPS password recovery.

Supports SMTP with STARTTLS (port 587), implicit SSL (port 465), or local relay servers
via environment variables. Never logs SMTP passwords, reset tokens, or sensitive credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
import html
import logging
import re
import smtplib
import ssl
from urllib.parse import urlencode

from app.core.config import Settings, get_settings

logger = logging.getLogger("wicps.email")

_EMAIL_REGEX = re.compile(r"^[^@\s\r\n]+@[^@\s\r\n]+\.[^@\s\r\n]+$")
_LOCAL_RELAY_HOSTS = {"localhost", "127.0.0.1", "::1"}


@dataclass(frozen=True)
class EmailDispatchResult:
    sent: bool
    provider: str
    reason: str | None = None
    error_code: str | None = None


def _is_valid_email(value: str | None) -> bool:
    cleaned = (value or "").strip()
    if not cleaned or "\r" in cleaned or "\n" in cleaned:
        return False
    return bool(_EMAIL_REGEX.match(cleaned))


def _is_gmail_host(host: str) -> bool:
    normalized = (host or "").strip().lower()
    return normalized in {"smtp.gmail.com", "smtp.googlemail.com"} or normalized.endswith(
        (".gmail.com", ".googlemail.com")
    )


def build_password_reset_url(frontend_base_url: str, raw_token: str) -> str:
    base = (frontend_base_url or "http://localhost:3000").strip().rstrip("/")
    query = urlencode({"token": raw_token})
    return f"{base}/reset-password?{query}"


def render_password_reset_email(
    *,
    display_name: str,
    reset_url: str,
    expire_minutes: int,
) -> tuple[str, str, str]:
    """Returns (subject, plain_text_body, html_body) with WICPS branding."""
    safe_name = html.escape(
        (display_name or "Forest Department User").strip() or "Forest Department User"
    )
    safe_url = html.escape(reset_url, quote=True)
    subject = "WICPS Password Reset Request"

    plain_text = (
        f"Hello {display_name or 'User'},\n\n"
        "We received a request to reset your password for the Wildlife Intelligence & Conflict "
        "Prediction System (WICPS).\n\n"
        f"Open the following link to set a new password:\n{reset_url}\n\n"
        f"This link will expire in {expire_minutes} minutes and can only be used once.\n\n"
        "If you did not request a password reset, you can safely ignore this email. "
        "Your current password will remain unchanged.\n\n"
        "— WICPS Security & Forest Operations Command"
    )

    html_body = f"""<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#020617;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#0f172a;border:1px solid #1e293b;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background-color:#020617;padding:24px 28px;border-bottom:1px solid #1e293b;">
                <div style="font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#34d399;font-family:monospace;">
                  WICPS Security Perimeter
                </div>
                <div style="font-size:20px;font-weight:800;color:#ffffff;margin-top:6px;">
                  Wildlife Intelligence &amp; Conflict Prediction System
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <p style="margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#e2e8f0;">
                  Hello <strong>{safe_name}</strong>,
                </p>
                <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#cbd5e1;">
                  We received a request to reset the password for your WICPS account. Click the button below to choose a new password.
                </p>
                <table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;">
                  <tr>
                    <td align="center" style="border-radius:10px;background-color:#059669;">
                      <a href="{safe_url}" style="display:inline-block;padding:13px 24px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Reset WICPS Password
                      </a>
                    </td>
                  </tr>
                </table>
                <div style="background-color:#020617;border:1px solid #1e293b;border-radius:10px;padding:14px 16px;margin:20px 0;font-size:12px;line-height:1.6;color:#94a3b8;">
                  <strong style="color:#34d399;">Security Notice:</strong> This password reset link expires in <strong>{expire_minutes} minutes</strong> and can only be used once.
                </div>
                <p style="margin:16px 0 8px 0;font-size:12px;color:#94a3b8;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 20px 0;font-size:12px;word-break:break-all;color:#34d399;font-family:monospace;">
                  {safe_url}
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">
                  If you did not request a password reset, no action is required and your password will remain unchanged.
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#020617;padding:16px 28px;border-top:1px solid #1e293b;font-size:11px;color:#64748b;text-align:center;">
                Forest Department Wildlife Intelligence &amp; Conflict Prediction System (WICPS)
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""

    return subject, plain_text, html_body


class SmtpEmailService:
    """Sends transactional recovery emails via configured SMTP (Gmail STARTTLS/SSL or SMTP relay)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _effective_password(self) -> str:
        raw = (self.settings.smtp_password or "").strip()
        if not raw:
            return ""
        # Gmail displays 16-character App Passwords grouped with spaces (e.g. "abcd efgh ijkl mnop").
        if _is_gmail_host(self.settings.smtp_host):
            return "".join(raw.split())
        return raw

    def get_configuration_error(self) -> str | None:
        """Returns a safe, non-secret diagnostic string when SMTP configuration is incomplete/invalid."""
        host = (self.settings.smtp_host or "").strip()
        from_email = (self.settings.smtp_from_email or "").strip()
        username = (self.settings.smtp_username or "").strip()
        password = self._effective_password()

        missing: list[str] = []
        if not host or any(ch.isspace() for ch in host):
            missing.append("SMTP_HOST")
        if not _is_valid_email(from_email):
            missing.append("SMTP_FROM_EMAIL")

        is_local_relay = host.lower() in _LOCAL_RELAY_HOSTS
        requires_auth = (not is_local_relay) or bool(username) or bool(password)
        if requires_auth:
            if not username:
                missing.append("SMTP_USERNAME")
            if not password:
                missing.append("SMTP_PASSWORD")

        if missing:
            return (
                f"Incomplete or invalid SMTP configuration ({', '.join(missing)}). "
                "Set valid SMTP environment variables in .env or backend/.env."
            )
        return None

    @property
    def is_configured(self) -> bool:
        return self.get_configuration_error() is None

    def _open_authenticated_client(self) -> smtplib.SMTP:
        host = (self.settings.smtp_host or "").strip()
        port = int(self.settings.smtp_port)
        timeout = int(self.settings.smtp_timeout_seconds)
        username = (self.settings.smtp_username or "").strip()
        password = self._effective_password()
        context = ssl.create_default_context()

        if port == 465:
            server: smtplib.SMTP = smtplib.SMTP_SSL(
                host,
                port,
                timeout=timeout,
                context=context,
            )
            server.ehlo()
        else:
            server = smtplib.SMTP(host, port, timeout=timeout)
            server.ehlo()
            if self.settings.smtp_use_tls:
                server.starttls(context=context)
                server.ehlo()

        if username:
            server.login(username, password)
        return server

    def _handle_smtp_exception(self, exc: Exception) -> EmailDispatchResult:
        host = (self.settings.smtp_host or "").strip()
        port = int(self.settings.smtp_port)

        if isinstance(exc, smtplib.SMTPAuthenticationError):
            logger.error(
                "SMTP authentication failed host=%s port=%s smtp_code=%s. "
                "Verify SMTP_USERNAME and SMTP_PASSWORD (for Gmail, use a 16-character App Password with 2-Step Verification enabled).",
                host,
                port,
                exc.smtp_code,
            )
            return EmailDispatchResult(
                sent=False,
                provider="smtp_error",
                reason="SMTP authentication failed",
                error_code="smtp_auth_failed",
            )

        if isinstance(exc, smtplib.SMTPSenderRefused):
            logger.error(
                "SMTP sender rejected host=%s port=%s smtp_code=%s from=%s. "
                "Verify SMTP_FROM_EMAIL is authorized for the configured SMTP account.",
                host,
                port,
                exc.smtp_code,
                self.settings.smtp_from_email,
            )
            return EmailDispatchResult(
                sent=False,
                provider="smtp_error",
                reason="SMTP sender address rejected",
                error_code="smtp_sender_refused",
            )

        if isinstance(exc, smtplib.SMTPRecipientsRefused):
            logger.error(
                "SMTP recipient rejected host=%s port=%s refused_count=%s",
                host,
                port,
                len(exc.recipients or {}),
            )
            return EmailDispatchResult(
                sent=False,
                provider="smtp_error",
                reason="SMTP recipient address rejected",
                error_code="smtp_recipient_refused",
            )

        if isinstance(
            exc,
            (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError, OSError),
        ):
            logger.error(
                "SMTP connection failed host=%s port=%s tls=%s error_type=%s",
                host,
                port,
                self.settings.smtp_use_tls,
                type(exc).__name__,
            )
            return EmailDispatchResult(
                sent=False,
                provider="smtp_error",
                reason=f"SMTP connection error ({type(exc).__name__})",
                error_code="smtp_connection_failed",
            )

        # Never log SMTP password, reset tokens, or raw exception payloads that could echo secrets
        logger.error(
            "SMTP password reset delivery failed host=%s port=%s error_type=%s",
            host,
            port,
            type(exc).__name__,
        )
        return EmailDispatchResult(
            sent=False,
            provider="smtp_error",
            reason=type(exc).__name__,
            error_code="smtp_error",
        )

    def verify_connection(self) -> EmailDispatchResult:
        """Verifies SMTP server connectivity and authentication without sending an email."""
        config_error = self.get_configuration_error()
        if config_error is not None:
            return EmailDispatchResult(
                sent=False,
                provider="smtp_unconfigured",
                reason=config_error,
                error_code="smtp_unconfigured",
            )
        try:
            with self._open_authenticated_client() as server:
                code, _ = server.noop()
                if code != 250:
                    return EmailDispatchResult(
                        sent=False,
                        provider="smtp_error",
                        reason=f"Unexpected SMTP NOOP response code {code}",
                        error_code="smtp_error",
                    )
            return EmailDispatchResult(sent=True, provider="smtp")
        except Exception as exc:
            return self._handle_smtp_exception(exc)

    def send_password_reset_email(
        self,
        *,
        to_email: str,
        display_name: str,
        reset_url: str,
        expire_minutes: int,
    ) -> EmailDispatchResult:
        clean_recipient = (to_email or "").strip()
        if not _is_valid_email(clean_recipient):
            logger.warning("Password reset email aborted: invalid recipient address format.")
            return EmailDispatchResult(
                sent=False,
                provider="smtp_error",
                reason="Invalid recipient email address",
                error_code="invalid_recipient",
            )

        config_error = self.get_configuration_error()
        if config_error is not None:
            logger.error(
                "Password reset email cannot be sent: %s (host=%s, port=%s, from=%s)",
                config_error,
                self.settings.smtp_host,
                self.settings.smtp_port,
                self.settings.smtp_from_email,
            )
            return EmailDispatchResult(
                sent=False,
                provider="smtp_unconfigured",
                reason=config_error,
                error_code="smtp_unconfigured",
            )

        subject, plain_text, html_body = render_password_reset_email(
            display_name=display_name,
            reset_url=reset_url,
            expire_minutes=expire_minutes,
        )

        from_email = (self.settings.smtp_from_email or "").strip()
        sender_domain = from_email.split("@", 1)[1] if "@" in from_email else "localhost"

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f"WICPS Security <{from_email}>"
        msg["To"] = clean_recipient
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid(domain=sender_domain)
        msg["Auto-Submitted"] = "auto-generated"
        msg.set_content(plain_text)
        msg.add_alternative(html_body, subtype="html")

        try:
            with self._open_authenticated_client() as server:
                refused = server.send_message(
                    msg,
                    from_addr=from_email,
                    to_addrs=[clean_recipient],
                )
                if refused:
                    logger.error(
                        "SMTP server refused password reset recipient host=%s port=%s refused_count=%s",
                        self.settings.smtp_host,
                        self.settings.smtp_port,
                        len(refused),
                    )
                    return EmailDispatchResult(
                        sent=False,
                        provider="smtp_error",
                        reason="SMTP server refused recipient",
                        error_code="smtp_recipient_refused",
                    )

            logger.info(
                "Password reset email accepted by SMTP server host=%s port=%s from=%s",
                self.settings.smtp_host,
                self.settings.smtp_port,
                from_email,
            )
            return EmailDispatchResult(sent=True, provider="smtp")
        except Exception as exc:
            return self._handle_smtp_exception(exc)


def get_email_service(settings: Settings | None = None) -> SmtpEmailService:
    return SmtpEmailService(settings or get_settings())
