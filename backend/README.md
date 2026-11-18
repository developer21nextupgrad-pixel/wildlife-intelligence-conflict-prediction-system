# WICPS FastAPI + PostgreSQL + PostGIS Backend (Phase 2)

Geospatial REST API backend for the **Wildlife Intelligence & Conflict Prediction System (WICPS)**.

## Architecture
- **Framework**: FastAPI
- **ORM / Spatial**: SQLAlchemy 2.x + GeoAlchemy2 (`Geometry(..., srid=4326)` + `GIST` spatial indexes)
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Migrations**: Alembic (`alembic/versions/0001_initial_schema.py`)
- **Validation**: Pydantic v2

## Quick Start with Docker Compose (Recommended)

From the project root:

```bash
docker compose up --build
```

This starts:
- `postgis` on `localhost:5432` (database `wicps`)
- `backend` on `http://localhost:8000` (auto-runs `alembic upgrade head`, exposes `/api/v1/docs`)

Then run the React frontend on port `3000`:

```bash
npm install
npm run dev
```

## Local Setup Without Docker

1. Provision a PostgreSQL database with PostGIS enabled:
   ```sql
   CREATE DATABASE wicps;
   \c wicps
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
2. Configure environment variables:
   ```bash
   cd backend
   cp .env.example .env
   # Update DATABASE_URL in .env if needed
   ```
3. Create virtualenv, install dependencies, migrate, and seed demo records (`is_demo=True`):
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   alembic upgrade head
   python -m app.services.seed
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

## Running Backend Tests

```bash
cd backend
pytest -v
```

To run tests directly against a dedicated PostgreSQL/PostGIS test database:

```bash
TEST_DATABASE_URL="postgresql+psycopg://wicps_user:wicps_dev_password@localhost:5432/wicps_test" pytest -v
```
