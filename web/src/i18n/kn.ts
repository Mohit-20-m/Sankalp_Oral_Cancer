import type { TKey } from "./en";

/** Kannada. Missing keys fall back to English. Please have a native clinical reviewer check before deployment. */
export const kn: Partial<Record<TKey, string>> = {
  "nav.home": "ಮುಖಪುಟ",
  "nav.newScreening": "ಹೊಸ ತಪಾಸಣೆ",
  "nav.patients": "ರೋಗಿಗಳು",
  "nav.queue": "ಪರಿಶೀಲನಾ ಸರದಿ",
  "nav.referralDesk": "ಶಿಫಾರಸು ಡೆಸ್ಕ್",
  "nav.notifications": "ಅಧಿಸೂಚನೆಗಳು",
  "nav.settings": "ಸೆಟ್ಟಿಂಗ್‌ಗಳು",
  "nav.section.work": "ಕೆಲಸದ ಸ್ಥಳ",
  "nav.section.insight": "ಒಳನೋಟಗಳು",
  "nav.section.system": "ವ್ಯವಸ್ಥೆ",

  "greet.morning": "ಶುಭೋದಯ",
  "greet.afternoon": "ಶುಭ ಮಧ್ಯಾಹ್ನ",
  "greet.evening": "ಶುಭ ಸಂಜೆ",

  "common.search": "ಹುಡುಕಿ",
  "common.searchPatients": "ಹೆಸರು, ಫೋನ್ ಅಥವಾ ರೋಗಿ ಐಡಿ ಮೂಲಕ ಹುಡುಕಿ",
  "common.continue": "ಮುಂದುವರಿಸಿ",
  "common.back": "ಹಿಂದೆ",
  "common.cancel": "ರದ್ದುಮಾಡಿ",
  "common.confirm": "ದೃಢೀಕರಿಸಿ",
  "common.save": "ಉಳಿಸಿ",
  "common.edit": "ತಿದ್ದು",
  "common.retry": "ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ",
  "common.signOut": "ಸೈನ್ ಔಟ್",
  "common.yes": "ಹೌದು",
  "common.no": "ಇಲ್ಲ",
  "common.notSure": "ಗೊತ್ತಿಲ್ಲ",

  "auth.welcome": "ಮರಳಿ ಸ್ವಾಗತ",
  "auth.username": "ಬಳಕೆದಾರ ಹೆಸರು",
  "auth.password": "ಪಾಸ್‌ವರ್ಡ್",
  "auth.signIn": "ಸೈನ್ ಇನ್",

  "step.patient": "ರೋಗಿ",
  "step.consent": "ಒಪ್ಪಿಗೆ",
  "step.habits": "ಅಭ್ಯಾಸಗಳು",
  "step.symptoms": "ಲಕ್ಷಣಗಳು",
  "step.photos": "ಫೋಟೋಗಳು",
  "step.mouth": "ಬಾಯಿ ತೆರೆಯುವಿಕೆ",
  "step.review": "ಪರಿಶೀಲಿಸಿ ಸಲ್ಲಿಸಿ",

  "screen.consentTitle": "ರೋಗಿಯ ಒಪ್ಪಿಗೆ",
  "screen.consentBody":
    "ನಾವು ನಿಮ್ಮ ಬಾಯಿಯ ಒಳಗೆ ನೋಡಿ 7 ಫೋಟೋಗಳನ್ನು ತೆಗೆಯುತ್ತೇವೆ. ವೈದ್ಯರು ನಿಮ್ಮನ್ನು ನೋಡಬೇಕೇ ಎಂದು ತೀರ್ಮಾನಿಸಲು ಕಂಪ್ಯೂಟರ್ ಸಹಾಯ ಮಾಡುತ್ತದೆ. ಇದು ರೋಗನಿರ್ಣಯವಲ್ಲ. ನಿಮ್ಮ ಫೋಟೋಗಳನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಇಡಲಾಗುತ್ತದೆ. ನೀವು ಯಾವಾಗ ಬೇಕಾದರೂ ನಿಲ್ಲಿಸಬಹುದು.",
  "screen.readAloud": "ಓದಿ ಹೇಳಿ",

  "habit.areca": "ಅಡಿಕೆ",
  "habit.tobacco": "ತಂಬಾಕು",
  "habit.alcohol": "ಮದ್ಯ",
  "habit.never": "ಎಂದೂ ಇಲ್ಲ",
  "habit.current": "ಈಗ ಇದೆ",
  "habit.past": "ಹಿಂದೆ ಇತ್ತು",

  "site.left_cheek": "ಎಡ ಕೆನ್ನೆ",
  "site.right_cheek": "ಬಲ ಕೆನ್ನೆ",
  "site.tongue_top": "ನಾಲಿಗೆಯ ಮೇಲ್ಭಾಗ",
  "site.tongue_under": "ನಾಲಿಗೆಯ ಕೆಳಗೆ",
  "site.gums": "ಒಸಡುಗಳು",
  "site.palate": "ಅಂಗುಳ",
  "site.open_mouth": "ಬಾಯಿ ತೆರೆದ ಮುಖ",

  "quality.good": "ಚೆನ್ನಾಗಿದೆ",
  "quality.fair": "ಸರಿಸುಮಾರು",
  "quality.poor": "ಮತ್ತೆ ತೆಗೆಯಿರಿ",

  "risk.LOW": "ಕಡಿಮೆ ಅಪಾಯ",
  "risk.MEDIUM": "ಮಧ್ಯಮ ಅಪಾಯ",
  "risk.HIGH": "ಹೆಚ್ಚಿನ ಅಪಾಯ",
  "risk.CANNOT_ASSESS": "ನಿರ್ಧರಿಸಲಾಗದು",
  "risk.NEEDS_REVIEW": "ಪರಿಶೀಲನೆ ಬೇಕು",

  "safety.disclaimer": "ತಪಾಸಣಾ ಸಹಾಯ ಮಾತ್ರ — ರೋಗನಿರ್ಣಯವಲ್ಲ.",
  "safety.preliminary": "ಪ್ರಾಥಮಿಕ ಫಲಿತಾಂಶ. ಅಪ್‌ಲೋಡ್ ನಂತರ ಅಂತಿಮ ಫಲಿತಾಂಶ.",

  "result.title": "ತಪಾಸಣಾ ಫಲಿತಾಂಶ",
  "result.visitBy": "ಈ ದಿನಾಂಕದೊಳಗೆ ಭೇಟಿ",

  "settings.title": "ಸೆಟ್ಟಿಂಗ್‌ಗಳು",
  "settings.language": "ಭಾಷೆ",
  "settings.textSize": "ಅಕ್ಷರದ ಗಾತ್ರ",
  "settings.sound": "ಧ್ವನಿ ಪರಿಣಾಮಗಳು",
};
