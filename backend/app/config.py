import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from .fileguard import private_mode
from .storage import file_lock

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv('DATABASE_URL', f'sqlite:///{ROOT / "data/xronix.db"}'))
    jwt_secret: str = field(default_factory=lambda: os.getenv('JWT_SECRET', ''), repr=False)
    jwt_expire_minutes: int = field(default_factory=lambda: int(os.getenv('JWT_EXPIRE_MINUTES', '1440')))
    mock_ai: bool = field(default_factory=lambda: os.getenv('MOCK_AI', 'true').lower() == 'true')
    ai_service_url: str = field(default_factory=lambda: os.getenv('AI_SERVICE_URL', 'http://localhost:8001').rstrip('/'))
    cors_origins: list[str] = field(default_factory=lambda: [v.strip() for v in os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if v.strip()])
    contracts_dir: Path = field(default_factory=lambda: Path(os.getenv('CONTRACTS_DIR', str(ROOT.parent / 'contracts'))))

    ai_requests_per_minute: int = field(default_factory=lambda: int(os.getenv('AI_REQUESTS_PER_MINUTE', '6')))
    ai_global_per_minute: int = field(default_factory=lambda: int(os.getenv('AI_GLOBAL_PER_MINUTE', '30')))
    ai_max_concurrent: int = field(default_factory=lambda: int(os.getenv('AI_MAX_CONCURRENT', '4')))
    api_requests_per_minute: int = field(default_factory=lambda: int(os.getenv('API_REQUESTS_PER_MINUTE', '120')))
    auth_requests_per_minute: int = field(default_factory=lambda: int(os.getenv('AUTH_REQUESTS_PER_MINUTE', '20')))
    max_body_bytes: int = 65536
    backup_enabled: bool = field(default_factory=lambda: os.getenv('BACKUP_ENABLED', 'false').lower() == 'true')
    backup_dir: str = field(default_factory=lambda: os.getenv('BACKUP_DIR', ''))
    backup_retention_count: int = field(default_factory=lambda: int(os.getenv('BACKUP_RETENTION_COUNT', '7')))
    backup_timeout_seconds: int = field(default_factory=lambda: int(os.getenv('BACKUP_TIMEOUT_SECONDS', '30')))
    db_min_free_mb: int = field(default_factory=lambda: int(os.getenv('DB_MIN_FREE_MB', '100')))

    smtp_host: str = field(default_factory=lambda: os.getenv('SMTP_HOST', ''))
    smtp_port: int = field(default_factory=lambda: int(os.getenv('SMTP_PORT', '587')))
    smtp_user: str = field(default_factory=lambda: os.getenv('SMTP_USER', ''))
    smtp_password: str = field(default_factory=lambda: os.getenv('SMTP_PASSWORD', ''), repr=False)
    mail_from: str = field(default_factory=lambda: os.getenv('MAIL_FROM', ''))
    public_app_url: str = field(default_factory=lambda: os.getenv('PUBLIC_APP_URL', 'https://xronix.ru/app'))

    @property
    def smtp_ready(self):
        return all((self.smtp_host, self.smtp_user, self.smtp_password, self.mail_from))

    @property
    def db_min_free_bytes(self):
        return self.db_min_free_mb * 1024 * 1024


    def __post_init__(self):
        if any(value < 1 for value in (self.jwt_expire_minutes, self.ai_requests_per_minute,
                self.ai_global_per_minute, self.ai_max_concurrent,
                self.api_requests_per_minute, self.auth_requests_per_minute)):
            raise ValueError('Limits and token lifetime must be positive')
        if self.backup_retention_count < 1 or self.backup_timeout_seconds < 1 or self.db_min_free_mb < 0:
            raise ValueError('Invalid database maintenance limits')
        if self.smtp_port not in (465, 587):
            raise ValueError('SMTP must use verified TLS on port 465 or 587')
        from urllib.parse import urlsplit
        app_url = urlsplit(self.public_app_url)
        if app_url.scheme != 'https' or not app_url.netloc or app_url.fragment or app_url.query:
            raise ValueError('Trusted HTTPS application URL required')
        if any(c in self.mail_from for c in '\r\n'):
            raise ValueError('Invalid mail sender')
        if not self.cors_origins or '*' in self.cors_origins:
            raise ValueError('Explicit CORS origins required')

    def signing_key(self):
        if self.jwt_secret:
            if len(self.jwt_secret.encode()) < 32:
                raise ValueError('JWT_SECRET must contain at least 32 bytes')
            return self.jwt_secret
        # Stable local key: tokens survive restarts. Never tracked by Git.
        path = ROOT / 'data/jwt.key'
        path.parent.mkdir(parents=True, exist_ok=True)
        with file_lock(path, exclusive=True, blocking=True) as guard:
            stream = guard.stream
            value = stream.read().strip()
            if not value:
                value = secrets.token_urlsafe(48)
                stream.seek(0)
                stream.write(value)
                stream.truncate()
                stream.flush()
                os.fsync(stream.fileno())
            if len(value.encode()) < 32:
                raise ValueError('Persisted JWT key is too short')
            private_mode(stream, path)
            return value
