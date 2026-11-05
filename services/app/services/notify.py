"""Create Message rows (delivery happens in the worker, via the outbox) — never send inline."""
from __future__ import annotations

from ..messaging import render
from ..models import Message
from ..outbox import emit_sync


def queue_sms(session, to_number: str | None, template: str, language: str, patient_id=None, related=None, **kw):
    if not to_number:
        return None
    body, lang = render(template, language, **kw)
    m = Message(channel="sms", to_number=to_number, template=template, language=lang, body=body,
                patient_id=patient_id, related=related or {}, status="queued")
    session.add(m)
    session.flush()
    emit_sync(session, "message.send", {"message_id": str(m.id)}, dedupe_key=f"msg:{m.id}")
    return m


def queue_voice(session, to_number: str | None, checkin_id, language: str, patient_id=None):
    if not to_number:
        return None
    body, lang = render("checkin_voice", language)
    m = Message(channel="voice", to_number=to_number, template="checkin_voice", language=lang, body=body,
                patient_id=patient_id, related={"checkin_id": str(checkin_id)}, status="queued")
    session.add(m)
    session.flush()
    emit_sync(session, "message.send", {"message_id": str(m.id)}, dedupe_key=f"msg:{m.id}")
    return m


def notify_staff(session, staff_id, template: str, related=None, **kw):
    if not staff_id:
        return None
    body, _ = render(template, "en", **kw)
    m = Message(channel="in_app", to_staff_id=staff_id, template=template, body=body, related=related or {},
                status="sent", provider="in_app")
    session.add(m)
    return m
