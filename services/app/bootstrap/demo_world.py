"""The demo world: facilities, villages and staff in Dakshina Kannada. IDs are deterministic (uuid5), so the
Keycloak realm file, the database and the documentation all agree. Names of facilities are fictional/demo."""
from __future__ import annotations

import uuid

NS = uuid.UUID("6f0c7d2e-1d7b-4c43-9b1e-0a7a5f0e5c11")


def fid(code: str) -> str:
    return str(uuid.uuid5(NS, f"facility:{code}"))


def uid(username: str) -> str:
    return str(uuid.uuid5(NS, f"user:{username}"))


FACILITIES = [
    # code, name, kind, lat, lon, accepts_referrals
    ("PHC-PUTTUR", "Primary Health Centre, Puttur (demo)", "phc", 12.7597, 75.2017, False),
    ("PHC-BELTHANGADY", "Primary Health Centre, Belthangady (demo)", "phc", 12.9886, 75.2723, False),
    ("PHC-SULLIA", "Primary Health Centre, Sullia (demo)", "phc", 12.5600, 75.3900, False),
    ("PHC-BANTWAL", "Primary Health Centre, Bantwal (demo)", "phc", 12.8900, 75.0350, False),
    ("OMC-MANGALURU", "Oral Medicine Centre, Mangaluru (demo dental college)", "dental_college", 12.8698, 74.8430,
     True),
]

VILLAGES = [
    # name, taluk, lat, lon, population
    ("Puttur", "Puttur", 12.7597, 75.2017, 9200), ("Kabaka", "Puttur", 12.7880, 75.2290, 3100),
    ("Uppinangady", "Puttur", 12.8360, 75.2490, 4800), ("Vitla", "Bantwal", 12.7660, 75.1080, 4200),
    ("Belthangady", "Belthangady", 12.9886, 75.2723, 6100), ("Ujire", "Belthangady", 12.9970, 75.3290, 3900),
    ("Sullia", "Sullia", 12.5600, 75.3900, 5600), ("Bellare", "Sullia", 12.6330, 75.3300, 2700),
    ("Bantwal", "Bantwal", 12.8900, 75.0350, 5900), ("Kalladka", "Bantwal", 12.8130, 75.1170, 3300),
]

STAFF = [
    # username, full name, role, facility code
    ("kavya.asha", "Kavya Shetty", "asha", "PHC-PUTTUR"),
    ("suma.asha", "Suma Gowda", "asha", "PHC-BELTHANGADY"),
    ("rekha.nurse", "Rekha Pai", "nurse", "PHC-PUTTUR"),
    ("dr.meera", "Dr. Meera Rao", "specialist", "OMC-MANGALURU"),
    ("dr.arjun", "Dr. Arjun Bhat", "specialist", "OMC-MANGALURU"),
    ("lead.rao", "Dr. Prakash Rao", "clinical_lead", None),
    ("lead.iyer", "Dr. Lakshmi Iyer", "clinical_lead", None),
    ("officer.dk", "District Health Officer (demo)", "district_officer", None),
    ("admin.ops", "Platform Admin", "admin", None),
]
DEMO_PASSWORD = "OralScreen@2026"

CONSENT_TEXTS = {
    "screening": {
        "en": "I agree that the health worker may ask about my habits, examine and photograph the inside of my mouth, "
              "and use a computer program to help decide if I should see a specialist. This is not a diagnosis.",
        "kn": "ಆರೋಗ್ಯ ಕಾರ್ಯಕರ್ತೆ ನನ್ನ ಅಭ್ಯಾಸಗಳ ಬಗ್ಗೆ ಕೇಳಲು, ನನ್ನ ಬಾಯಿಯ ಒಳಭಾಗವನ್ನು ಪರೀಕ್ಷಿಸಿ ಫೋಟೋ ತೆಗೆಯಲು ಮತ್ತು ತಜ್ಞರನ್ನು "
              "ಕಾಣಬೇಕೇ ಎಂದು ನಿರ್ಧರಿಸಲು ಕಂಪ್ಯೂಟರ್ ಸಹಾಯ ಬಳಸಲು ನಾನು ಒಪ್ಪುತ್ತೇನೆ. ಇದು ರೋಗನಿರ್ಣಯವಲ್ಲ.",
        "tcy": "ಆರೋಗ್ಯ ಕಾರ್ಯಕರ್ತೆ ಎನ್ನ ಬಾಯಿನ್ ಪರೀಕ್ಷೆ ಮಲ್ತ್‌ದ್ ಫೋಟೋ ದೆಪ್ಪುನೆಕ್ ಯಾನ್ ಒಪ್ಪುವೆ. ಉಂದು ರೋಗನಿರ್ಣಯ ಅತ್ತ್.",
    },
    "sharing": {
        "en": "I agree that my screening record may be shared with the specialist and with any doctor I choose to "
              "show my health card to, using a code sent to my phone.",
        "kn": "ನನ್ನ ತಪಾಸಣಾ ದಾಖಲೆಯನ್ನು ತಜ್ಞರೊಂದಿಗೆ ಮತ್ತು ನನ್ನ ಫೋನ್‌ಗೆ ಬರುವ ಸಂಖ್ಯೆಯ ಮೂಲಕ ನಾನು ಆಯ್ಕೆ ಮಾಡುವ ವೈದ್ಯರೊಂದಿಗೆ "
              "ಹಂಚಿಕೊಳ್ಳಲು ನಾನು ಒಪ್ಪುತ್ತೇನೆ.",
        "tcy": "ಎನ್ನ ದಾಖಲೆನ್ ತಜ್ಞೆರೆನೊಟ್ಟುಗು ಪಾಲ್ ಮಲ್ಪುನೆಕ್ ಯಾನ್ ಒಪ್ಪುವೆ.",
    },
    "ai_training": {
        "en": "I agree that my mouth photos, without my name, may be used to improve the screening program. "
              "I can withdraw this at any time.",
        "kn": "ನನ್ನ ಹೆಸರಿಲ್ಲದೆ ನನ್ನ ಬಾಯಿಯ ಫೋಟೋಗಳನ್ನು ತಪಾಸಣಾ ವ್ಯವಸ್ಥೆ ಸುಧಾರಿಸಲು ಬಳಸಲು ನಾನು ಒಪ್ಪುತ್ತೇನೆ. "
              "ಯಾವಾಗ ಬೇಕಾದರೂ ಇದನ್ನು ಹಿಂಪಡೆಯಬಹುದು.",
        "tcy": "ಎನ್ನ ಪುದರ್ ಇಜ್ಜಂದೆ ಫೋಟೋಲೆನ್ ವ್ಯವಸ್ಥೆ ಸುಧಾರಣೆಗ್ ಗಳಸುನೆಕ್ ಒಪ್ಪುವೆ.",
    },
}
