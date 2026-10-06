"""
Central place for all configuration.

Nothing in this file hardcodes an environment (dev vs production) — instead,
every value is read from environment variables (which, locally, come from
your ".env" file). That's a standard professional pattern: the *code* never
changes between your laptop and a real server, only the *environment
variables* do. This is often called "12-factor config".

Everywhere else in the app, you import `settings` from this module instead
of reading `os.environ` directly — that way there is exactly one place that
knows how configuration is loaded.
"""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # --- Database ---
    MONGODB_URL: str = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "glypad"

    # --- Storage ---
    STORAGE_BACKEND: Literal["local", "s3"] = "local"
    LOCAL_STORAGE_DIR: str = "../storage/local_files"

    AWS_S3_BUCKET: str = ""
    AWS_REGION: str = "ap-south-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""

    # --- App ---
    CORS_ORIGINS: str = "http://localhost:5173"
    MAX_UPLOAD_MB: int = 200

    # --- Working-file cache (IMPLEMENTATION_PLAN.md §7) ---
    # A cached drawing's bytes are a 30-day working copy, not a permanent
    # archive — the annotation data itself never expires, only the preview
    # pixels. CLEANUP_INTERVAL_HOURS controls how often the in-process
    # cleanup loop (app/core/scheduler.py) checks for files past that TTL;
    # neither needs to be exact-to-the-minute, so both are deliberately
    # coarse-grained.
    WORKING_FILE_TTL_DAYS: int = 30
    CLEANUP_INTERVAL_HOURS: int = 24

    # --- Auth ---
    # Every login token is cryptographically signed with this value — anyone
    # who has it can forge a valid login for any user, so it must be a long
    # random string kept secret and different in every environment. The
    # default below is fine for local development only; .env.example spells
    # out how to generate a real one for anything else.
    SECRET_KEY: str = "dev-only-secret-change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # --- AI region suggestions (Gemini) ---
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.0-flash"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.MAX_UPLOAD_MB * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    """
    Returns the same Settings instance every time it's called within one
    running process (that's what @lru_cache does here) instead of re-reading
    environment variables on every request.
    """
    return Settings()


settings = get_settings()
