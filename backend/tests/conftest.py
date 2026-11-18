from collections.abc import Generator
import os

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import Base, get_db
from app.main import create_application
from app.services.seed import seed_demo_data


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
def client(db_session: Session) -> Generator[TestClient, None, None]:
    settings = Settings(
        environment="test",
        auto_seed_demo_data=False,
        rate_limit_requests=500,
        rate_limit_window_seconds=60,
    )
    app = create_application(settings)

    def _override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def seeded_client(client: TestClient, db_session: Session) -> TestClient:
    seed_demo_data(db_session)
    return client
