from fastapi import APIRouter

from app.api.routes import alerts, gis, health, incidents, patrols, sightings, villages

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(incidents.router)
api_router.include_router(sightings.router)
api_router.include_router(villages.router)
api_router.include_router(alerts.router)
api_router.include_router(patrols.router)
api_router.include_router(gis.router)
