import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OS_ENV", "test")
os.environ.setdefault("OS_AUTH_MODE", "local")
os.environ.setdefault("OS_OTEL_ENABLED", "false")
