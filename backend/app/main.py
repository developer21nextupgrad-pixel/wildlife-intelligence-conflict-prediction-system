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
from app.services.seed import seed_demo_data

logger = logging.getLogger("wicps.app")


def create_application(custom_settings: Settings | None = None) -> FastAPI:
    settings = custom_settings or get_settings()
    settings.validate_production_requirements()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if settings.auto_seed_demo_data:
            try:
                with SessionLocal() as db:
                    seed_demo_data(db)
            except Exception as exc:
                logger.warning("Startup demo seed skipped: %s", exc)
        yield

    application = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Geospatial REST API for Wildlife Intelligence & Conflict Prediction System (WICPS). "
            "Built with FastAPI, SQLAlchemy 2.x, GeoAlchemy2, and PostgreSQL/PostGIS."
        ),
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
        docs_url=f"{settings.api_v1_prefix}/docs",
        lifespan=lifespan,
    )

    register_exception_handlers(application)

    cors_kwargs: dict = {
        "allow_origins": settings.cors_origins_list,
        "allow_origin_regex": settings.cors_origin_regex or None,
        "allow_credentials": True,
        "allow_methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        "allow_headers": ["Authorization", "Content-Type", "X-Requested-With", "X-Camera-Key"],
    }
    if "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters:
        cors_kwargs["allow_private_network"] = True

    application.add_middleware(CORSMiddleware, **cors_kwargs)

    limiter = SlidingWindowRateLimiter(
        max_requests=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )
    application.state.rate_limiter = limiter
    application.add_middleware(
        RateLimitMiddleware,
        limiter=limiter,
        exempt_paths={
            f"{settings.api_v1_prefix}/health",
            f"{settings.api_v1_prefix}/docs",
            f"{settings.api_v1_prefix}/openapi.json",
        },
    )

    @application.middleware("http")
    async def private_network_access_middleware(request: Request, call_next):
        response = await call_next(request)
        if (
            request.method == "OPTIONS"
            and request.headers.get("access-control-request-private-network", "").lower() == "true"
            and "access-control-allow-origin" in response.headers
            and "access-control-allow-private-network" not in response.headers
        ):
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    application.include_router(api_router, prefix=settings.api_v1_prefix)
    return application


app = create_application()
