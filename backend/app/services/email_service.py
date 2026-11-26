"""SMTP email delivery service for WICPS password recovery.

Supports Gmail SMTP (STARTTLS on port 587 or SSL on port 465) via environment variables.
Never logs SMTP passwords, reset tokens, or sensitive credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
import html
import logging
import smtplib
import ssl
from urllib.parse import urlencode

from app.core.config import Settings, get_settings

logger = logging.getLogger("wicps.email")


@dataclass(frozen=True)
class EmailDispatchResult:
    sent: bool
    provider: str
    reason: str | None = None


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
    safe_name = html.escape((display_name or "Forest Department User").strip() or "Forest Department User")
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
    """Sends transactional recovery emails via configured SMTP (Gmail STARTTLS/SSL)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def is_configured(self) -> bool:
        return bool(
            (self.settings.smtp_host or "").strip()
            and (self.settings.smtp_from_email or "").strip()
            and (self.settings.smtp_username or "").strip()
            and (self.settings.smtp_password or "").strip()
        )

    def send_password_reset_email(
        self,
        *,
        to_email: str,
        display_name: str,
        reset_url: str,
        expire_minutes: int,
    ) -> EmailDispatchResult:
        subject, plain_text, html_body = render_password_reset_email(
            display_name=display_name,
            reset_url=reset_url,
            expire_minutes=expire_minutes,
        )

        if not self.is_configured:
            logger.warning(
                "Password reset email skipped: SMTP credentials are not configured (host=%s, from=%s). "
                "Set SMTP_PASSWORD (Gmail App Password) to enable outbound recovery emails.",
                self.settings.smtp_host,
                self.settings.smtp_from_email,
            )
            return EmailDispatchResult(
                sent=False,
                provider="smtp_unconfigured",
                reason="SMTP credentials not configured",
            )

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f"WICPS Security <{self.settings.smtp_from_email}>"
        msg["To"] = to_email
        msg.set_content(plain_text)
        msg.add_alternative(html_body, subtype="html")

        try:
            context = ssl.create_default_context()
            if self.settings.smtp_port == 465:
                with smtplib.SMTP_SSL(
                    self.settings.smtp_host,
                    self.settings.smtp_port,
                    timeout=self.settings.smtp_timeout_seconds,
                    context=context,
                ) as server:
                    server.login(self.settings.smtp_username or "", self.settings.smtp_password or "")
                    server.send_message(msg)
            else:
                with smtplib.SMTP(
                    self.settings.smtp_host,
                    self.settings.smtp_port,
                    timeout=self.settings.smtp_timeout_seconds,
                ) as server:
                    server.ehlo()
                    if self.settings.smtp_use_tls:
                        server.starttls(context=context)
                        server.ehlo()
                    server.login(self.settings.smtp_username or "", self.settings.smtp_password or "")
                    server.send_message(msg)

            logger.info(
                "Password reset email dispatched via SMTP host=%s port=%s",
                self.settings.smtp_host,
                self.settings.smtp_port,
            )
            return EmailDispatchResult(sent=True, provider="smtp")
        except Exception as exc:
            # Never log SMTP password, recipient token, or raw exception payloads that could echo secrets
            logger.error(
                "SMTP password reset delivery failed host=%s port=%s error_type=%s",
                self.settings.smtp_host,
                self.settings.smtp_port,
                type(exc).__name__,
            )
            return EmailDispatchResult(
                sent=False,
                provider="smtp_error",
                reason=type(exc).__name__,
            )


def get_email_service(settings: Settings | None = None) -> SmtpEmailService:
    return SmtpEmailService(settings or get_settings())
