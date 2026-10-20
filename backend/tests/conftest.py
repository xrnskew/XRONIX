"""Legacy tests exercise v1 explicitly; round-two tests enable the new defaults."""
import pytest


@pytest.fixture(autouse=True)
def isolated_feature_defaults(monkeypatch):
    monkeypatch.setenv('SEED_DEMO','false')
    monkeypatch.setenv('CONSULT_CHAT','false')
