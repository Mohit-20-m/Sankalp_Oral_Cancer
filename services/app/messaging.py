"""Patient & staff messaging: SMS, voice (IVR) and in-app notifications.

* twilio mode: real SMS / calls through Twilio (circuit-breaker protected, retried by the worker).
* sandbox mode: nothing leaves the system; every message is stored and visible at /api/v1/admin/messages.
Templates are multilingual (Kannada, Tulu in Kannada script, English) and never contain diagnoses.
"""
from __future__ import annotations

from datetime import datetime, timezone

from .config import get_settings
from .observability import MESSAGES, log
from .resilience import breaker

TEMPLATES: dict[str, dict[str, str]] = {
    "referral_patient": {
        "en": "Arogya: please visit {facility} by {due}. Show your referral slip. This is a screening check, "
              "not a diagnosis. Questions: call your ASHA.",
        "kn": "ಆರೋಗ್ಯ: ದಯವಿಟ್ಟು {due} ಒಳಗೆ {facility} ಗೆ ಭೇಟಿ ನೀಡಿ. ನಿಮ್ಮ ರೆಫರಲ್ ಚೀಟಿ ತೋರಿಸಿ. ಇದು ತಪಾಸಣೆ ಮಾತ್ರ, "
              "ರೋಗನಿರ್ಣಯವಲ್ಲ. ಪ್ರಶ್ನೆಗಳಿಗೆ ನಿಮ್ಮ ಆಶಾ ಕಾರ್ಯಕರ್ತೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
        "tcy": "ಆರೋಗ್ಯ: {due} ದುಲಾಯಿ {facility} ಗ್ ಪೋಲೆ. ರೆಫರಲ್ ಚೀಟಿ ತೋಜಾಲೆ. ಉಂದು ತಪಾಸಣೆ ಮಾತ್ರ.",
    },
    "appointment_booked": {
        "en": "Arogya: your appointment at {facility} is on {when}. Please bring your referral slip. "
              "This is a screening check, not a diagnosis.",
        "kn": "ಆರೋಗ್ಯ: {facility} ನಲ್ಲಿ ನಿಮ್ಮ ಭೇಟಿ {when} ರಂದು ನಿಗದಿಯಾಗಿದೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ರೆಫರಲ್ ಚೀಟಿ ತನ್ನಿ.",
    },
    "checkin_sms": {
        "en": "Arogya check-in: is the burning or soreness in your mouth back? Reply 1 = YES, 2 = NO.",
        "kn": "ಆರೋಗ್ಯ: ಬಾಯಲ್ಲಿ ಉರಿ ಅಥವಾ ನೋವು ಮತ್ತೆ ಬಂದಿದೆಯೇ? ಹೌದು ಎಂದರೆ 1, ಇಲ್ಲ ಎಂದರೆ 2 ಎಂದು ಉತ್ತರಿಸಿ.",
        "tcy": "ಆರೋಗ್ಯ: ಬಾಯಿಡ್ ಉರಿ ಪಿರ ಬತ್ತುಂಡಾ? ಅಂಡ್ 1, ಇಜ್ಜಿ 2.",
    },
    "checkin_voice": {
        "en": "Hello, this is Arogya. Has the burning or soreness in your mouth come back? Press 1 for yes. "
              "Press 2 for no.",
        "kn": "ನಮಸ್ಕಾರ, ಇದು ಆರೋಗ್ಯ. ಬಾಯಲ್ಲಿ ಉರಿ ಮತ್ತೆ ಬಂದಿದೆಯೇ? ಹೌದು ಎಂದರೆ ಒಂದು ಒತ್ತಿ. ಇಲ್ಲ ಎಂದರೆ ಎರಡು ಒತ್ತಿ.",
        "tcy": "ನಮಸ್ಕಾರ, ಉಂದು ಆರೋಗ್ಯ. ಬಾಯಿಡ್ ಉರಿ ಪಿರ ಬತ್ತುಂಡಾ? ಅಂಡ್ ಒಂಜಿ, ಇಜ್ಜಿ ರಡ್ಡ್.",
    },
    "provider_otp": {
        "en": "Arogya: {provider} is asking to see your mouth-health record. Share this code ONLY if you agree: "
              "{otp}. Valid {minutes} min.",
        "kn": "ಆರೋಗ್ಯ: {provider} ನಿಮ್ಮ ಬಾಯಿ ಆರೋಗ್ಯ ದಾಖಲೆ ನೋಡಲು ಕೇಳುತ್ತಿದ್ದಾರೆ. ನೀವು ಒಪ್ಪಿದರೆ ಮಾತ್ರ ಈ ಸಂಖ್ಯೆ ಹಂಚಿ: "
              "{otp}. {minutes} ನಿಮಿಷ ಮಾನ್ಯ.",
        "tcy": "ಆರೋಗ್ಯ: {provider} ಇರೆನ ದಾಖಲೆ ತೂಯೆರೆ ಕೇನೊಂದುಲ್ಲೆರ್. ಒಪ್ಪಿಡ ಮಾತ್ರ ಈ ಸಂಖ್ಯೆ: {otp}.",
    },
    "followup_due": {
        "en": "Arogya: your mouth check-up is due on {due}. Your ASHA will visit you.",
        "kn": "ಆರೋಗ್ಯ: ನಿಮ್ಮ ಬಾಯಿ ತಪಾಸಣೆ {due} ರಂದು ಇದೆ. ನಿಮ್ಮ ಆಶಾ ಕಾರ್ಯಕರ್ತೆ ಭೇಟಿ ನೀಡುತ್ತಾರೆ.",
        "tcy": "ಆರೋಗ್ಯ: {due} ಕ್ ಬಾಯಿ ತಪಾಸಣೆ ಉಂಡು.",
    },
    "provider_outcome": {
        "en": "Arogya: the specialist review for your patient {patient_ref} is complete: {verdict}. "
              "Open your Provider Connect link for details.",
    },
    # staff (in-app) notifications
    "staff_review_done": {"en": "Specialist reviewed {patient}: {verdict}. {action}"},
    "staff_escalation": {"en": "Escalation: {patient} reports symptoms returned. Case moved up the specialist queue."},
    "staff_followup_due": {"en": "Follow-up due {due} for {patient} ({reason})."},
    "staff_referral_overdue": {"en": "Referral overdue: {patient} has not visited {facility} (due {due})."},
    "staff_model_alert": {"en": "Model alert: {detail}"},
}


def render(template: str, language: str, **kw) -> tuple[str, str]:
    t = TEMPLATES[template]
    lang = language if language in t else "en"
    try:
        return t[lang].format(**kw), lang
    except KeyError:
        return t["en"].format(**kw), "en"


# Twilio trial accounts may only send these predefined bodies (docs: twilio.com/docs/usage/trials/try-out-sms).
TRIAL_TEMPLATES = {
    "referral_patient": "sms_appointment_reminders",
    "appointment_booked": "sms_appointment_reminders",
    "followup_due": "sms_appointment_reminders",
    "checkin_sms": "sms_feedback_surveys",
    "provider_otp": "sms_2fa",
    "provider_outcome": "sms_account_alerts",
}
TRIAL_DEFAULT = "sms_event_notifications"


def mask(number: str | None) -> str:
    if not number:
        return ""
    return number[:3] + "****" + number[-3:] if len(number) > 6 else "****"


class TwilioProvider:
    name = "twilio"

    def __init__(self):
        from twilio.rest import Client

        s = get_settings()
        if not (s.twilio_account_sid and s.twilio_from_number):
            raise RuntimeError("Twilio account SID or sender number missing")
        if s.twilio_api_key_sid and s.twilio_api_key_secret:      # API key (recommended: revocable, scoped)
            self.client = Client(s.twilio_api_key_sid, s.twilio_api_key_secret, s.twilio_account_sid)
        elif s.twilio_auth_token:
            self.client = Client(s.twilio_account_sid, s.twilio_auth_token)
        else:
            raise RuntimeError("Twilio credentials missing (API key + secret, or auth token)")
        self.from_ = s.twilio_from_number

    def sms(self, to: str, body: str, status_callback: str | None = None) -> str:
        kw = {"to": to, "from_": self.from_, "body": body}
        if status_callback:
            kw["status_callback"] = status_callback
        return breaker("twilio", 4, 60).call(self.client.messages.create, **kw).sid

    def call(self, to: str, twiml_url: str, status_callback: str | None = None) -> str:
        kw = {"to": to, "from_": self.from_, "url": twiml_url}
        if status_callback:
            kw["status_callback"] = status_callback
        return breaker("twilio", 4, 60).call(self.client.calls.create, **kw).sid


class SandboxProvider:
    name = "sandbox"

    def sms(self, to: str, body: str, status_callback: str | None = None) -> str:
        log.info("sandbox_sms", to=mask(to), chars=len(body))
        return "SANDBOX-SMS"

    def call(self, to: str, twiml_url: str, status_callback: str | None = None) -> str:
        log.info("sandbox_call", to=mask(to), url=twiml_url)
        return "SANDBOX-CALL"


def provider():
    s = get_settings()
    if s.messaging_mode == "twilio":
        try:
            return TwilioProvider()
        except Exception as e:  # noqa: BLE001
            log.error("twilio_unavailable_falling_back_to_sandbox", error=str(e))
    return SandboxProvider()


def deliver(message) -> None:
    """Send a stored Message row (called by the worker). Raises on failure so Celery retries it."""
    s = get_settings()
    p = provider()
    if message.channel == "in_app":
        message.status, message.provider = "sent", "in_app"
    elif message.channel == "sms":
        cb = f"{s.public_webhook_base}/api/v1/webhooks/twilio/status" if s.public_webhook_base else None
        body = message.body
        if p.name == "twilio" and s.twilio_trial_templates:          # trial account: predefined template only
            body = TRIAL_TEMPLATES.get(message.template, TRIAL_DEFAULT)
            message.related = {**(message.related or {}), "twilio_trial_template": body}
        message.provider_sid = p.sms(message.to_number, body, cb)
        message.provider = p.name
        message.status = "sandbox" if p.name == "sandbox" else "sent"
    elif message.channel == "voice":
        if not s.public_webhook_base and p.name == "twilio":
            raise RuntimeError("Voice calls need OS_PUBLIC_WEBHOOK_BASE (ngrok URL) so Twilio can fetch the script")
        url = f"{s.public_webhook_base}/api/v1/webhooks/twilio/voice?checkin={message.related.get('checkin_id')}"
        message.provider_sid = p.call(message.to_number, url)
        message.provider = p.name
        message.status = "sandbox" if p.name == "sandbox" else "sent"
    message.sent_at = datetime.now(timezone.utc)
    MESSAGES.labels(message.channel, message.status).inc()
