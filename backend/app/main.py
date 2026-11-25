from contextlib import asynccontextmanager
import inspect
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import api_router
from app.core.config import Settings, get_settings
from app.core.database import SessionLocal
from app.core.exceptions import register_exception_handlers
from app.core.rate_limit import RateLimitMiddleware, SlidingWindowRateLimiter
from app.core.security import bootstrap_admin_from_env
from app.services.animal_detection import get_animal_detection_pipeline
from app.services.megadescriptor import get_megadescriptor_extractor
from app.services.seed import seed_demo_data

logger = logging.getLogger("wicps.app")


def create_application(custom_settings: Settings | None = None) -> FastAPI:
    settings = custom_settings or get_settings()
    settings.validate_production_requirements()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        try:
            with SessionLocal() as db:
                bootstrap_admin_from_env(db, settings)
                if settings.auto_seed_demo_data:
                    seed_demo_data(db)
        except Exception as exc:
            if settings.is_production:
                logger.error(
                    "Production startup DB initialization failed (%s). Verify Alembic migrations are up to date with 'alembic -c alembic.ini upgrade head'.",
                    exc,
                )
            else:
                logger.warning("Startup DB initialization skipped: %s", exc)
        if settings.speciesnet_preload_on_startup:
            try:
                get_animal_detection_pipeline(settings).ensure_loaded()
            except Exception as exc:
                logger.warning("Startup SpeciesNet preload failed: %s", exc)
        if settings.megadescriptor_preload_on_startup and settings.megadescriptor_enabled:
            try:
                get_megadescriptor_extractor(settings).ensure_loaded()
            except Exception as exc:
                logger.warning("Startup MegaDescriptor preload failed: %s", exc)
        yield

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Geospatial REST API for Wildlife Intelligence & Conflict Prediction System (WICPS). "
            "Built with FastAPI, SQLAlchemy 2.x, GeoAlchemy2, and PostgreSQL/PostGIS."
        ),
        openapi_url=None if settings.is_production else f"{settings.api_v1_prefix}/openapi.json",
        docs_url=None if settings.is_production else f"{settings.api_v1_prefix}/docs",
        lifespan=lifespan,
    )

    register_exception_handlers(application)

    cors_kwargs: dict = {
        "allow_origins": settings.cors_origins_list,
        "allow_origin_regex": (settings.cors_origin_regex or None)
        if not settings.is_production or (settings.cors_origin_regex or "").strip()
        else None,
        "allow_credentials": True,
        "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        "allow_headers": [
            "Authorization",
            "Content-Type",
            "X-Requested-With",
            "X-Camera-Key",
            "Idempotency-Key",
        ],
    }
    if "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters:
        cors_kwargs["allow_private_network"] = not settings.is_production

    application.add_middleware(CORSMiddleware, **cors_kwargs)

    limiter = SlidingWindowRateLimiter(
        max_requests=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    application.state.rate_limiter = limiter
    strict_limits = {
        f"{settings.api_v1_prefix}/auth/login": (
            settings.auth_login_rate_limit_requests,
            settings.auth_login_rate_limit_window_seconds,
        ),
        f"{settings.api_v1_prefix}/auth/bootstrap-admin": (
            settings.auth_login_rate_limit_requests,
            settings.auth_login_rate_limit_window_seconds,
        ),
    }
    application.add_middleware(
        RateLimitMiddleware,
        limiter=limiter,
        exempt_paths={
            f"{settings.api_v1_prefix}/health",
            f"{settings.api_v1_prefix}/docs",
            f"{settings.api_v1_prefix}/openapi.json",
        },
        strict_route_limits=strict_limits,
    )

    @application.middleware("http")
    async def private_network_access_middleware(request: Request, call_next):
        response = await call_next(request)
        if (
            not settings.is_production
            and request.method == "OPTIONS"
            and request.headers.get("access-control-request-private-network", "").lower() == "true"
            and "access-control-allow-origin" in response.headers
            and "access-control-allow-private-network" not in response.headers
        ):
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    application.include_router(api_router, prefix=settings.api_v1_prefix)
    if custom_settings is not None:
        application.dependency_overrides[get_settings] = lambda: settings
    return application


app = create_application()
