from fastapi import APIRouter

from app.api.routes import (
    alerts,
    animal_intelligence,
    assistant,
    auth,
    cameras,
    detections,
    gis,
    health,
    incidents,
    ingest,
    iot,
    patrols,
    sightings,
    villages,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(health.router)
api_router.include_router(assistant.router)
api_router.include_router(incidents.router)
api_router.include_router(sightings.router)
api_router.include_router(villages.router)
api_router.include_router(alerts.router)
api_router.include_router(patrols.router)
api_router.include_router(gis.router)
api_router.include_router(cameras.router)
api_router.include_router(ingest.router)
api_router.include_router(detections.router)
api_router.include_router(animal_intelligence.router)
api_router.include_router(iot.router)
