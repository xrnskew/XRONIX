import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv('DATABASE_URL', f'sqlite:///{ROOT / "data/xronix.db"}'))
    jwt_secret: str = field(default_factory=lambda: os.getenv('JWT_SECRET', ''))
    jwt_expire_minutes: int = field(default_factory=lambda: int(os.getenv('JWT_EXPIRE_MINUTES', '1440')))
    mock_ai: bool = field(default_factory=lambda: os.getenv('MOCK_AI', 'true').lower() == 'true')
    ai_service_url: str = field(default_factory=lambda: os.getenv('AI_SERVICE_URL', 'http://localhost:8001').rstrip('/'))
    cors_origins: list[str] = field(default_factory=lambda: [v.strip() for v in os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',') if v.strip()])
    contracts_dir: Path = field(default_factory=lambda: Path(os.getenv('CONTRACTS_DIR', str(ROOT.parent / 'contracts'))))

    def signing_key(self):
        if self.jwt_secret:
            if len(self.jwt_secret.encode()) < 32:
                raise ValueError('JWT_SECRET must contain at least 32 bytes')
            return self.jwt_secret
        # Stable local key: tokens survive restarts. Never tracked by Git.
        path = ROOT / 'data/jwt.key'
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(path, 'x', opener=lambda p, flags: os.open(p, flags, 0o600)) as f:
                f.write(secrets.token_urlsafe(48))
        except FileExistsError:
            pass
        return path.read_text().strip()
