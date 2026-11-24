from collections.abc import Generator
import os
import uuid

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import create_application
from app.services.seed import seed_demo_data

TEST_JWT_SECRET = "test-only-hs256-jwt-signing-secret-32bytes-minimum"


def make_test_settings(**overrides) -> Settings:
    params = {
        "environment": "test",
        "auto_seed_demo_data": False,
        "rate_limit_requests": 500,
        "rate_limit_window_seconds": 60,
        "auth_enabled": True,
        "auth_jwt_secret": TEST_JWT_SECRET,
    }
    params.update(overrides)
    return Settings(**params)


def make_test_token(
    settings: Settings,
    *,
    role: str = "admin",
    subject: str | None = None,
    email: str | None = None,
    display_name: str | None = None,
    user_id: uuid.UUID | None = None,
) -> str:
    norm_role = role.strip().lower()
    return create_access_token(
        subject=subject or f"test-{norm_role}@wicps.test",
        email=email or f"test-{norm_role}@wicps.test",
        display_name=display_name or f"Test {norm_role.title()}",
        role=norm_role,
        settings=settings,
        user_id=user_id,
    )


def auth_headers(
    settings: Settings,
    *,
    role: str = "admin",
    subject: str | None = None,
    email: str | None = None,
    display_name: str | None = None,
) -> dict[str, str]:
    token = make_test_token(
        settings,
        role=role,
        subject=subject,
        email=email,
        display_name=display_name,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def test_engine():
    test_db_url = os.environ.get("TEST_DATABASE_URL")
    if test_db_url:
        engine = create_engine(test_db_url, pool_pre_ping=True, future=True)
    else:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, _connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session(test_engine) -> Generator[Session, None, None]:
    TestingSessionLocal = sessionmaker(
        bind=test_engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    # Clean all tables before each test for deterministic isolation
    with TestingSessionLocal() as cleanup:
        for table in reversed(Base.metadata.sorted_tables):
            cleanup.execute(table.delete())
        cleanup.commit()

    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def test_settings() -> Settings:
    return make_test_settings()


@pytest.fixture()
def anon_client(db_session: Session, test_settings: Settings) -> Generator[TestClient, None, None]:
    app = create_application(test_settings)

    def _override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as raw_client:
        yield raw_client
    app.dependency_overrides.clear()


@pytest.fixture()
def client(anon_client: TestClient, test_settings: Settings) -> Generator[TestClient, None, None]:
    anon_client.headers.update(auth_headers(test_settings, role="admin"))
    yield anon_client


@pytest.fixture()
def operator_client(
    db_session: Session, test_settings: Settings
) -> Generator[TestClient, None, None]:
    app = create_application(test_settings)
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as tc:
        tc.headers.update(auth_headers(test_settings, role="operator"))
        yield tc
    app.dependency_overrides.clear()


@pytest.fixture()
def reviewer_client(
    db_session: Session, test_settings: Settings
) -> Generator[TestClient, None, None]:
    app = create_application(test_settings)
    app.dependency_overrides[get_db] = lambda: db_session
    with TestClient(app) as tc:
        tc.headers.update(auth_headers(test_settings, role="reviewer"))
        yield tc
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded_client(client: TestClient, db_session: Session) -> TestClient:
    seed_demo_data(db_session)
    return client
