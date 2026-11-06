"""SMS delivery: custom text normally, Twilio predefined templates when the trial-template switch is on."""
from types import SimpleNamespace

from app import messaging
from app.config import get_settings


class FakeTwilio:
    name = "twilio"

    def __init__(self):
        self.sent = []

    def sms(self, to, body, status_callback=None):
        self.sent.append(body)
        return "SM123"


def _msg(template):
    return SimpleNamespace(channel="sms", to_number="+919876543210", template=template,
                           body="Arogya: please visit the clinic", related={}, provider=None,
                           provider_sid=None, status="queued", sent_at=None)


def test_custom_text_when_not_trial(monkeypatch):
    fake = FakeTwilio()
    monkeypatch.setattr(messaging, "provider", lambda: fake)
    monkeypatch.setattr(get_settings(), "twilio_trial_templates", False)
    m = _msg("referral_patient")
    messaging.deliver(m)
    assert fake.sent == ["Arogya: please visit the clinic"] and m.status == "sent"


def test_trial_templates_map_to_predefined_bodies(monkeypatch):
    fake = FakeTwilio()
    monkeypatch.setattr(messaging, "provider", lambda: fake)
    monkeypatch.setattr(get_settings(), "twilio_trial_templates", True)
    for tpl, expected in [("referral_patient", "sms_appointment_reminders"), ("provider_otp", "sms_2fa"),
                          ("checkin_sms", "sms_feedback_surveys"), ("unknown_template", "sms_event_notifications")]:
        m = _msg(tpl)
        messaging.deliver(m)
        assert fake.sent[-1] == expected and m.related["twilio_trial_template"] == expected
        assert m.body.startswith("Arogya:")          # the real text is kept for the admin view
