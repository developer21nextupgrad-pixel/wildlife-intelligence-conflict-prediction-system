from datetime import datetime, timedelta, timezone
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, is_postgres_backend
from app.models import (
    Alert,
    AlertRule,
    ForestOfficer,
    Incident,
    Patrol,
    RiskZone,
    Sighting,
    TelemetryRecord,
    Village,
)
from app.services.spatial import make_point_geom, make_polygon_geom

logger = logging.getLogger("wicps.seed")


def seed_demo_data(db: Session) -> dict[str, int]:
    """
    Idempotently seeds prototype demo records marked with `is_demo=True`.
    Operational records created via API carry `is_demo=False`.
    """
    postgres = is_postgres_backend(db)
    now = datetime.now(timezone.utc)
    inserted: dict[str, int] = {
        "villages": 0,
        "risk_zones": 0,
        "incidents": 0,
        "sightings": 0,
        "alerts": 0,
        "patrols": 0,
        "telemetry_records": 0,
        "forest_officers": 0,
        "alert_rules": 0,
    }

    village_defs = [
        {
            "name": "Kadambur Fringe",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "population": 1420,
            "households": 285,
            "forest_distance_km": 0.35,
            "latitude": 11.6640,
            "longitude": 76.6220,
            "risk_level": "Critical",
            "risk_score": 89,
            "active_solar_fence": True,
            "fence_status": "Breached",
            "assigned_rrt": "Hediyala Sector QRT-1",
            "emergency_contact": "+91 821 240 1926 (Panchayat Base)",
            "recent_incidents_30d": 7,
        },
        {
            "name": "Mangala Settlement",
            "district": "Bandipur Division",
            "forest_range": "Gundlupet Buffer",
            "population": 860,
            "households": 172,
            "forest_distance_km": 0.6,
            "latitude": 11.6880,
            "longitude": 76.6430,
            "risk_level": "Critical",
            "risk_score": 84,
            "active_solar_fence": True,
            "fence_status": "Maintenance Required",
            "assigned_rrt": "Gundlupet QRT-2",
            "emergency_contact": "+91 821 240 1928",
            "recent_incidents_30d": 5,
        },
        {
            "name": "Omkar Forest Fringe",
            "district": "Bandipur Division",
            "forest_range": "Omkar Range",
            "population": 1120,
            "households": 230,
            "forest_distance_km": 0.8,
            "latitude": 11.6390,
            "longitude": 76.5920,
            "risk_level": "High",
            "risk_score": 72,
            "active_solar_fence": True,
            "fence_status": "Operational",
            "assigned_rrt": "Omkar Beat Mobile Squad",
            "emergency_contact": "+91 821 240 1930",
            "recent_incidents_30d": 4,
        },
        {
            "name": "Berambadi Village",
            "district": "Bandipur Division",
            "forest_range": "Maddur Range",
            "population": 2300,
            "households": 490,
            "forest_distance_km": 1.4,
            "latitude": 11.7120,
            "longitude": 76.6270,
            "risk_level": "High",
            "risk_score": 68,
            "active_solar_fence": False,
            "fence_status": "Maintenance Required",
            "assigned_rrt": "Maddur Emergency Unit",
            "emergency_contact": "+91 821 240 1934",
            "recent_incidents_30d": 3,
        },
        {
            "name": "Solakarai Colony",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "population": 640,
            "households": 120,
            "forest_distance_km": 0.25,
            "latitude": 11.6760,
            "longitude": 76.5650,
            "risk_level": "Moderate",
            "risk_score": 54,
            "active_solar_fence": True,
            "fence_status": "Operational",
            "assigned_rrt": "Hediyala Sector QRT-1",
            "emergency_contact": "+91 821 240 1936",
            "recent_incidents_30d": 2,
        },
        {
            "name": "Maddur Colony",
            "district": "Bandipur Division",
            "forest_range": "Maddur Range",
            "population": 1750,
            "households": 360,
            "forest_distance_km": 1.1,
            "latitude": 11.6220,
            "longitude": 76.6350,
            "risk_level": "Moderate",
            "risk_score": 48,
            "active_solar_fence": True,
            "fence_status": "Operational",
            "assigned_rrt": "Maddur Range Patrol",
            "emergency_contact": "+91 821 240 1940",
            "recent_incidents_30d": 2,
        },
        {
            "name": "Gopalaswamy Base",
            "district": "Bandipur Division",
            "forest_range": "GS Betta Range",
            "population": 520,
            "households": 98,
            "forest_distance_km": 2.1,
            "latitude": 11.7260,
            "longitude": 76.5980,
            "risk_level": "Low",
            "risk_score": 26,
            "active_solar_fence": True,
            "fence_status": "Operational",
            "assigned_rrt": "GS Betta Unit",
            "emergency_contact": "+91 821 240 1944",
            "recent_incidents_30d": 1,
        },
    ]

    village_map: dict[str, Village] = {}
    for v_def in village_defs:
        existing = db.execute(select(Village).where(Village.name == v_def["name"])).scalar_one_or_none()
        if existing:
            village_map[existing.name] = existing
            continue
        v = Village(
            **v_def,
            geom=make_point_geom(v_def["latitude"], v_def["longitude"], postgres),
            is_demo=True,
        )
        db.add(v)
        db.flush()
        village_map[v.name] = v
        inserted["villages"] += 1

    risk_zone_defs = [
        {
            "name": "Sector 4B Northern Wildlife Corridor",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "village_id": village_map["Kadambur Fringe"].id,
            "risk_level": "Critical",
            "risk_score": 92,
            "dominant_species": "Asian Elephant",
            "center_lat": 11.665,
            "center_lng": 76.615,
            "polygon_coordinates": [
                [11.650, 76.595],
                [11.680, 76.605],
                [11.685, 76.635],
                [11.655, 76.630],
            ],
            "active_alert_count": 2,
            "primary_risk_factor": "Ripe sugarcane + dry stream bed funneling herds directly into Kadambur",
        },
        {
            "name": "Gundlupet Buffer Predation Pocket",
            "district": "Bandipur Division",
            "forest_range": "Gundlupet Buffer",
            "village_id": village_map["Mangala Settlement"].id,
            "risk_level": "High",
            "risk_score": 78,
            "dominant_species": "Indian Leopard",
            "center_lat": 11.692,
            "center_lng": 76.635,
            "polygon_coordinates": [
                [11.680, 76.620],
                [11.710, 76.630],
                [11.705, 76.655],
                [11.675, 76.645],
            ],
            "active_alert_count": 1,
            "primary_risk_factor": "Dense lantana weed clusters providing stealth cover right up to backyard cattle sheds",
        },
        {
            "name": "Maddur Highway & Elephant Pass",
            "district": "Bandipur Division",
            "forest_range": "Maddur Range",
            "village_id": village_map["Maddur Colony"].id,
            "risk_level": "High",
            "risk_score": 71,
            "dominant_species": "Asian Elephant",
            "center_lat": 11.628,
            "center_lng": 76.625,
            "polygon_coordinates": [
                [11.615, 76.610],
                [11.640, 76.615],
                [11.635, 76.645],
                [11.610, 76.638],
            ],
            "active_alert_count": 1,
            "primary_risk_factor": "Traditional linear migration route bisected by state highway and overhead powerlines",
        },
        {
            "name": "Omkar Western Sanctuary Fringe",
            "district": "Bandipur Division",
            "forest_range": "Omkar Range",
            "village_id": village_map["Omkar Forest Fringe"].id,
            "risk_level": "Moderate",
            "risk_score": 56,
            "dominant_species": "Bengal Tiger",
            "center_lat": 11.642,
            "center_lng": 76.585,
            "polygon_coordinates": [
                [11.630, 76.570],
                [11.660, 76.575],
                [11.655, 76.600],
                [11.625, 76.592],
            ],
            "active_alert_count": 0,
            "primary_risk_factor": "Occasional buffer perimeter incursions by dispersing young adult carnivores",
        },
    ]

    for rz_def in risk_zone_defs:
        exists = db.execute(select(RiskZone).where(RiskZone.name == rz_def["name"])).scalar_one_or_none()
        if exists:
            continue
        rz = RiskZone(
            **rz_def,
            geom=make_polygon_geom(rz_def["polygon_coordinates"], postgres),
            is_demo=True,
        )
        db.add(rz)
        inserted["risk_zones"] += 1

    incident_defs = [
        {
            "incident_code": "WICPS-2026-089",
            "species": "Asian Elephant",
            "date_time": now - timedelta(hours=8),
            "latitude": 11.6624,
            "longitude": 76.6189,
            "village_id": village_map["Kadambur Fringe"].id,
            "village": "Kadambur Fringe",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range (Beat 4)",
            "incident_type": "Crop Depredation",
            "severity": "High",
            "human_injury": "None",
            "human_injuries_count": 0,
            "livestock_loss_count": 0,
            "crop_damage_estimated_acres": 3.8,
            "crop_type": "Mature Sugarcane & Paddy",
            "description": "A herd of 7 elephants, including 2 sub-adults, breached the solar fence at pylon 54 and entered agricultural plots. Forest QRT fired blank rounds to drive them back towards the teak reserve.",
            "image_url": "https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80",
            "status": "Patrol Dispatched",
            "reported_by": "Range Forest Officer Suresh Kumar",
            "assigned_officer": "RFO S. Kumar (QRT-1)",
            "action_taken": "Crackers & spotlight deployment. Solar fence repair order issued.",
        },
        {
            "incident_code": "WICPS-2026-088",
            "species": "Indian Leopard",
            "date_time": now - timedelta(hours=14),
            "latitude": 11.6892,
            "longitude": 76.6412,
            "village_id": village_map["Mangala Settlement"].id,
            "village": "Mangala Settlement",
            "district": "Bandipur Division",
            "forest_range": "Gundlupet Buffer",
            "incident_type": "Livestock Predation",
            "severity": "Critical",
            "human_injury": "Minor",
            "human_injuries_count": 1,
            "livestock_loss_count": 2,
            "crop_damage_estimated_acres": 0.0,
            "description": "Male leopard ambushed a cattle pen behind a farm house. A shepherd sustained minor forearm scratches while sounding metal alarm plates. Leopard retreated into lantana bushes.",
            "image_url": "https://images.unsplash.com/photo-1456926631375-92c8ce872def?auto=format&fit=crop&w=800&q=80",
            "status": "Under Control",
            "reported_by": "Village Panchayat President",
            "assigned_officer": "Veterinary Officer Dr. Anjali Rao",
            "action_taken": "Cage trap deployed at GPS waypoint LP-02; shepherd provided first aid at primary health centre.",
        },
        {
            "incident_code": "WICPS-2026-087",
            "species": "Bengal Tiger",
            "date_time": now - timedelta(days=2),
            "latitude": 11.6415,
            "longitude": 76.5891,
            "village_id": village_map["Omkar Forest Fringe"].id,
            "village": "Omkar Forest Fringe",
            "district": "Bandipur Division",
            "forest_range": "Omkar Range",
            "incident_type": "Village Incursion",
            "severity": "High",
            "human_injury": "None",
            "human_injuries_count": 0,
            "livestock_loss_count": 1,
            "crop_damage_estimated_acres": 0.0,
            "description": "Sub-adult female tiger sighted near the village water tank. Tiger dragged a goat towards boundary nullah. Thermal drone deployed to verify boundary return.",
            "image_url": "https://images.unsplash.com/photo-1561731216-c3a4d99437d5?auto=format&fit=crop&w=800&q=80",
            "status": "Verified",
            "reported_by": "Beat Guard M. Basavaraj",
            "assigned_officer": "Beat Guard M. Basavaraj",
            "action_taken": "Thermal drone monitoring initiated. Villagers advised to avoid peripheral grazing for 48 hrs.",
        },
        {
            "incident_code": "WICPS-2026-086",
            "species": "Sloth Bear",
            "date_time": now - timedelta(days=3),
            "latitude": 11.7105,
            "longitude": 76.6250,
            "village_id": village_map["Berambadi Village"].id,
            "village": "Berambadi Village",
            "district": "Bandipur Division",
            "forest_range": "Maddur Range",
            "incident_type": "Human Injury / Attack",
            "severity": "Critical",
            "human_injury": "Severe",
            "human_injuries_count": 1,
            "livestock_loss_count": 0,
            "crop_damage_estimated_acres": 0.5,
            "crop_type": "Maize field & Banana trees",
            "description": "Farmer returning after nocturnal borewell operation encountered a mother sloth bear with cubs feeding on fallen honeycomb and maize. Farmer sustained deep lacerations. Rapid medical evacuation conducted.",
            "image_url": "https://images.unsplash.com/photo-1589656966895-2f33e7653819?auto=format&fit=crop&w=800&q=80",
            "status": "Resolved",
            "reported_by": "Emergency Toll-free 1926 Call",
            "assigned_officer": "Assistant Conservator of Forests K. Gowda",
            "action_taken": "Immediate ex-gratia compensation processed (Rs 50,000 provisional); night patrol doubled.",
        },
        {
            "incident_code": "WICPS-2026-085",
            "species": "Wild Boar",
            "date_time": now - timedelta(days=4),
            "latitude": 11.6780,
            "longitude": 76.5620,
            "village_id": village_map["Solakarai Colony"].id,
            "village": "Solakarai Settlement",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "incident_type": "Crop Depredation",
            "severity": "Moderate",
            "human_injury": "None",
            "human_injuries_count": 0,
            "livestock_loss_count": 0,
            "crop_damage_estimated_acres": 2.1,
            "crop_type": "Groundnut & Potato",
            "description": "Sounder of approximately 14 wild boars rooted up newly seeded tuber crops. Elephant-proof trench was silted up at this sector enabling crossing.",
            "image_url": "https://images.unsplash.com/photo-1547407139-3c921a66005c?auto=format&fit=crop&w=800&q=80",
            "status": "Resolved",
            "reported_by": "Village Forest Committee",
            "assigned_officer": "Range Officer R. Nair",
            "action_taken": "Excavator dispatched to re-desilt 120m of trench perimeter.",
        },
        {
            "incident_code": "WICPS-2026-084",
            "species": "Asian Elephant",
            "date_time": now - timedelta(days=5),
            "latitude": 11.6250,
            "longitude": 76.6320,
            "village_id": village_map["Maddur Colony"].id,
            "village": "Maddur Colony",
            "district": "Bandipur Division",
            "forest_range": "Maddur Range",
            "incident_type": "Infrastructure Breach",
            "severity": "High",
            "human_injury": "None",
            "human_injuries_count": 0,
            "livestock_loss_count": 0,
            "crop_damage_estimated_acres": 1.2,
            "crop_type": "Banana Plantations",
            "description": "Solitary tusker (Makhna) pushed over two concrete electrical poles causing localized blackout, then browsed through banana orchard.",
            "image_url": "https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80",
            "status": "Closed",
            "reported_by": "Electricity Board Lineman",
            "assigned_officer": "RFO S. Kumar (QRT-1)",
            "action_taken": "Power shut down immediately by substation; tusker steered back by elephant drive squad.",
        },
        {
            "incident_code": "WICPS-2026-083",
            "species": "Gaur",
            "date_time": now - timedelta(days=10),
            "latitude": 11.7240,
            "longitude": 76.5950,
            "village_id": village_map["Gopalaswamy Base"].id,
            "village": "Gopalaswamy Foothills",
            "district": "Bandipur Division",
            "forest_range": "GS Betta Range",
            "incident_type": "Village Incursion",
            "severity": "Low",
            "human_injury": "None",
            "human_injuries_count": 0,
            "livestock_loss_count": 0,
            "crop_damage_estimated_acres": 0.4,
            "description": "Three Indian Gaur browsed grass along temple approach road. No aggression displayed; moved back into reserve spontaneously upon vehicle traffic.",
            "image_url": "https://images.unsplash.com/photo-1534188753412-3e26d0d618d6?auto=format&fit=crop&w=800&q=80",
            "status": "Closed",
            "reported_by": "Tourist Beat Guard",
            "assigned_officer": "Beat Guard P. Murthy",
            "action_taken": "Vehicular speed limit enforced on temple road.",
        },
    ]

    for inc_def in incident_defs:
        exists = db.execute(
            select(Incident).where(Incident.incident_code == inc_def["incident_code"])
        ).scalar_one_or_none()
        if exists:
            continue
        inc = Incident(
            **inc_def,
            geom=make_point_geom(inc_def["latitude"], inc_def["longitude"], postgres),
            is_demo=True,
        )
        db.add(inc)
        inserted["incidents"] += 1

    sighting_defs = [
        {
            "sighting_code": "SIGHT-2026-312",
            "species": "Asian Elephant",
            "timestamp": now - timedelta(hours=3),
            "latitude": 11.6680,
            "longitude": 76.6120,
            "location_name": "Sector 4B Stream Checkdam",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "herd_size": 8,
            "movement_direction": "North-East",
            "bearing_degrees": 45,
            "behavior": "Moving towards village",
            "juveniles_present": True,
            "observation_details": "Family group moving deliberately along stream line towards Kadambur paddy outskirts. Leading matriarch with radio collar #EL-04 visible.",
            "observer_name": "Beat Guard Ramesh K.",
            "observer_role": "Forest Guard (Beat 4)",
            "verified_by_forest_guard": True,
            "photo_url": "https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80",
        },
        {
            "sighting_code": "SIGHT-2026-311",
            "species": "Indian Leopard",
            "timestamp": now - timedelta(hours=9),
            "latitude": 11.6910,
            "longitude": 76.6380,
            "location_name": "Rocky Escarpment near Mangala",
            "district": "Bandipur Division",
            "forest_range": "Gundlupet Buffer",
            "herd_size": 1,
            "movement_direction": "West",
            "bearing_degrees": 270,
            "behavior": "Foraging",
            "juveniles_present": False,
            "observation_details": "Automated camera trap #CT-18 triggered. Adult male stalking along dry boulder gully 350m from goat sheds.",
            "observer_name": "Camera Trap AI Sensor #CT-18",
            "observer_role": "Automated Grid Camera",
            "verified_by_forest_guard": True,
        },
        {
            "sighting_code": "SIGHT-2026-310",
            "species": "Bengal Tiger",
            "timestamp": now - timedelta(hours=16),
            "latitude": 11.6350,
            "longitude": 76.5780,
            "location_name": "Omkar Perennial Salt Lick",
            "district": "Bandipur Division",
            "forest_range": "Omkar Range",
            "herd_size": 1,
            "movement_direction": "Stationary",
            "bearing_degrees": 0,
            "behavior": "Resting",
            "juveniles_present": False,
            "observation_details": "Healthy male tiger (Identified as T-114) resting in bamboo clump near natural salt lick. Pugs fresh.",
            "observer_name": "Wildlife Biologist Sneha Patil",
            "observer_role": "Field Biologist",
            "verified_by_forest_guard": True,
        },
        {
            "sighting_code": "SIGHT-2026-309",
            "species": "Wild Boar",
            "timestamp": now - timedelta(days=2),
            "latitude": 11.6740,
            "longitude": 76.5590,
            "location_name": "Solakarai Wetland Margin",
            "district": "Bandipur Division",
            "forest_range": "Hediyala Range",
            "herd_size": 18,
            "movement_direction": "East",
            "bearing_degrees": 90,
            "behavior": "Foraging",
            "juveniles_present": True,
            "observation_details": "Large sounder rooting along swamp edge. High likelihood of crossing village boundary after nightfall.",
            "observer_name": "Forest Watcher Mahadeva",
            "observer_role": "Community Forest Watcher",
            "verified_by_forest_guard": False,
        },
        {
            "sighting_code": "SIGHT-2026-308",
            "species": "Asian Elephant",
            "timestamp": now - timedelta(days=4),
            "latitude": 11.6190,
            "longitude": 76.6280,
            "location_name": "Maddur Elephant Corridor Link",
            "district": "Bandipur Division",
            "forest_range": "Maddur Range",
            "herd_size": 2,
            "movement_direction": "South-East",
            "bearing_degrees": 135,
            "behavior": "Moving towards village",
            "juveniles_present": False,
            "observation_details": "Two adult bulls crossing inter-reserve highway road cut. Vehicular traffic temporarily halted for 12 minutes.",
            "observer_name": "Highways Patrol Unit",
            "observer_role": "Inter-Agency Unit",
            "verified_by_forest_guard": True,
        },
    ]

    for s_def in sighting_defs:
        exists = db.execute(
            select(Sighting).where(Sighting.sighting_code == s_def["sighting_code"])
        ).scalar_one_or_none()
        if exists:
            continue
        s = Sighting(
            **s_def,
            geom=make_point_geom(s_def["latitude"], s_def["longitude"], postgres),
            is_demo=True,
        )
        db.add(s)
        inserted["sightings"] += 1

    alert_defs = [
        {
            "title": "CRITICAL: Elephant Herd Incursion Imminent",
            "message": "Collar #EL-04 and 7 uncollared elephants detected 280m from Kadambur crop fence. Moving NE directly toward sugarcane fields.",
            "severity": "Critical",
            "species": "Asian Elephant",
            "affected_village": "Kadambur Fringe",
            "village_id": village_map["Kadambur Fringe"].id,
            "district": "Bandipur Division",
            "latitude": 11.6624,
            "longitude": 76.6189,
            "alert_time": "18 mins ago (05:42 IST)",
            "triggered_at": now - timedelta(minutes=18),
            "acknowledged": False,
            "assigned_officer": "RFO Suresh Kumar",
            "response_status": "RRT En Route",
        },
        {
            "title": "HIGH: Leopard Sighted Near Mangala School Perimeter",
            "message": "Camera trap CT-18 triggered twice in 40 minutes. Predator stalking perimeter cattle pen; school route caution advised.",
            "severity": "High",
            "species": "Indian Leopard",
            "affected_village": "Mangala Settlement",
            "village_id": village_map["Mangala Settlement"].id,
            "district": "Bandipur Division",
            "latitude": 11.6892,
            "longitude": 76.6412,
            "alert_time": "1 hr 12 mins ago (04:48 IST)",
            "triggered_at": now - timedelta(minutes=72),
            "acknowledged": True,
            "acknowledged_by": "DFO Wildlife Ops",
            "acknowledged_at": now - timedelta(minutes=60),
            "assigned_officer": "Veterinary Officer Dr. Anjali Rao",
            "response_status": "On Scene",
        },
        {
            "title": "MODERATE: Sounder of Boars Encroaching Groundnut Plots",
            "message": "Estimated 18 wild boars congregating near water drain; potential crop damage expected before dawn.",
            "severity": "Moderate",
            "species": "Wild Boar",
            "affected_village": "Solakarai Colony",
            "village_id": village_map["Solakarai Colony"].id,
            "district": "Bandipur Division",
            "latitude": 11.6780,
            "longitude": 76.5620,
            "alert_time": "2 hrs 25 mins ago (03:35 IST)",
            "triggered_at": now - timedelta(minutes=145),
            "acknowledged": True,
            "acknowledged_by": "RFO R. Nair",
            "acknowledged_at": now - timedelta(minutes=130),
            "assigned_officer": "RFO R. Nair",
            "response_status": "Pending Dispatch",
        },
        {
            "title": "ADVISORY: Bull Elephant Near Inter-State Highway 76",
            "message": "Makhna tusker observed grazing 40m from highway edge near Maddur. Traffic wardens alerted to enforce speed limit.",
            "severity": "Moderate",
            "species": "Asian Elephant",
            "affected_village": "Maddur Colony",
            "village_id": village_map["Maddur Colony"].id,
            "district": "Bandipur Division",
            "latitude": 11.6250,
            "longitude": 76.6320,
            "alert_time": "4 hrs ago (02:00 IST)",
            "triggered_at": now - timedelta(hours=4),
            "acknowledged": True,
            "acknowledged_by": "Beat Guard P. Murthy",
            "acknowledged_at": now - timedelta(hours=3, minutes=45),
            "assigned_officer": "Beat Guard P. Murthy",
            "response_status": "Area Cleared",
        },
    ]

    for a_def in alert_defs:
        exists = db.execute(select(Alert).where(Alert.title == a_def["title"])).scalar_one_or_none()
        if exists:
            continue
        alert = Alert(
            **a_def,
            geom=make_point_geom(a_def["latitude"], a_def["longitude"], postgres),
            is_demo=True,
        )
        db.add(alert)
        inserted["alerts"] += 1

    patrol_defs = [
        {
            "patrol_code": "PTR-2026-081",
            "team_name": "QRT Alpha — Strike Tactical Vehicle",
            "lead_officer": "Captain K. Ravindran",
            "target_area": "Kadambur Agricultural Border & Stream Checkdam",
            "sector": "Sector 4B (Northern Corridor)",
            "district": "Bandipur Division",
            "village_id": village_map["Kadambur Fringe"].id,
            "priority": "Critical",
            "status": "In Progress",
            "scheduled_window": "18:00 - 04:00 IST (Nocturnal)",
            "active_personnel": 5,
            "equipment": [
                "Thermal Vision Scope",
                "High-decibel Acoustic Siren",
                "Non-lethal Pyrotechnics",
                "4x4 Forest Defender Jeep",
            ],
            "risk_rationale": "Direct interception for Asian Elephant herd (Collar #EL-04) near breached pylon 54",
            "approved_by": "Dr. Vikramaditya Sen, IFS (DFO)",
            "latitude": 11.6624,
            "longitude": 76.6189,
        },
        {
            "patrol_code": "PTR-2026-082",
            "team_name": "Gundlupet Predator Containment Squad",
            "lead_officer": "Dr. Anjali Rao (Wildlife Biologist)",
            "target_area": "Mangala Settlement Outer Cattle Corrals",
            "sector": "Gundlupet Buffer Beat 02",
            "district": "Bandipur Division",
            "village_id": village_map["Mangala Settlement"].id,
            "priority": "High",
            "status": "On Station",
            "scheduled_window": "19:30 - 03:00 IST",
            "active_personnel": 4,
            "equipment": [
                "Humane Box Trap #02",
                "Veterinary Tranquilizer Kit",
                "High-intensity Halogen Searchlights",
                "VHF Handset",
            ],
            "risk_rationale": "Active leopard predation on domestic livestock; school pathway safeguard",
            "approved_by": "Dr. Vikramaditya Sen, IFS (DFO)",
            "latitude": 11.6892,
            "longitude": 76.6412,
        },
        {
            "patrol_code": "PTR-2026-083",
            "team_name": "Hediyala Range Perimeter Squad Charlie",
            "lead_officer": "Suresh Kumar, SFS (RFO)",
            "target_area": "Sector 4B Stream Gully & Solar Line Pylons 40-75",
            "sector": "Hediyala Range (Beats 3 & 4)",
            "district": "Bandipur Division",
            "village_id": village_map["Kadambur Fringe"].id,
            "priority": "High",
            "status": "Scheduled",
            "scheduled_window": "14:00 - 18:30 IST (Pre-dusk sweep)",
            "active_personnel": 6,
            "equipment": [
                "Solar Fence Fault Meter",
                "Trench Clearance Shovels",
                "High-visibility Vest Gear",
            ],
            "risk_rationale": "Preventive energizer inspection and elephant-proof trench clearance before night foraging",
            "approved_by": "Suresh Kumar, SFS (RFO)",
            "latitude": 11.6680,
            "longitude": 76.6120,
        },
        {
            "patrol_code": "PTR-2026-084",
            "team_name": "Maddur Highway Wildlife Traffic Warden Unit",
            "lead_officer": "P. Murthy (Beat Guard)",
            "target_area": "Inter-State Highway 76 Corridor Link",
            "sector": "Maddur Beat 06",
            "district": "Bandipur Division",
            "village_id": village_map["Maddur Colony"].id,
            "priority": "Medium",
            "status": "In Progress",
            "scheduled_window": "Continuous 24h Rotation",
            "active_personnel": 3,
            "equipment": [
                "Radar Speed Gun",
                "Reflective LED Warning Batons",
                "Megaphone Public Address Unit",
            ],
            "risk_rationale": "Mitigate vehicular speed along traditional bull elephant crossing road cut",
            "approved_by": "Assistant Conservator of Forests K. Gowda",
            "latitude": 11.6250,
            "longitude": 76.6320,
        },
        {
            "patrol_code": "PTR-2026-085",
            "team_name": "Omkar Core Sanctuary Foot Patrol",
            "lead_officer": "M. Basavaraj (Beat Guard)",
            "target_area": "Omkar Natural Salt Lick & Bamboo Fringe",
            "sector": "Omkar Beat 03",
            "district": "Bandipur Division",
            "village_id": village_map["Omkar Forest Fringe"].id,
            "priority": "Low",
            "status": "Completed",
            "scheduled_window": "06:00 - 12:00 IST (Morning Shift)",
            "active_personnel": 4,
            "equipment": [
                "Garmin eTrex GPS Handheld",
                "Camera Trap Retrieval Kit",
                "Pugmark Plaster Kits",
            ],
            "risk_rationale": "Tiger T-114 territory monitoring and camera trap SD card harvesting",
            "approved_by": "Suresh Kumar, SFS (RFO)",
            "latitude": 11.6350,
            "longitude": 76.5780,
        },
    ]

    for p_def in patrol_defs:
        exists = db.execute(
            select(Patrol).where(Patrol.patrol_code == p_def["patrol_code"])
        ).scalar_one_or_none()
        if exists:
            continue
        p = Patrol(
            **p_def,
            geom=make_point_geom(p_def["latitude"], p_def["longitude"], postgres),
            is_demo=True,
        )
        db.add(p)
        inserted["patrols"] += 1

    # Schema foundation sample rows for telemetry_records (not exposed publicly)
    telemetry_defs = [
        {
            "animal_id": "EL-04",
            "animal_name": 'Matriarch "Bhadra"',
            "species": "Asian Elephant",
            "collar_battery": 84,
            "recorded_at": now - timedelta(minutes=6),
            "latitude": 11.6645,
            "longitude": 76.6160,
            "speed_kmh": 3.4,
            "direction": "North-East (Heading 52°)",
            "status": "Approaching Boundary",
            "is_sensitive": True,
        },
        {
            "animal_id": "T-114",
            "animal_name": 'Dominant Male Tiger "Chinnappa"',
            "species": "Bengal Tiger",
            "collar_battery": 92,
            "recorded_at": now - timedelta(minutes=18),
            "latitude": 11.6385,
            "longitude": 76.5820,
            "speed_kmh": 1.1,
            "direction": "South-West (Stationary in bamboo)",
            "status": "In Forest Core",
            "is_sensitive": True,
        },
    ]
    for t_def in telemetry_defs:
        exists = db.execute(
            select(TelemetryRecord).where(TelemetryRecord.animal_id == t_def["animal_id"])
        ).scalar_one_or_none()
        if exists:
            continue
        t = TelemetryRecord(
            **t_def,
            geom=make_point_geom(t_def["latitude"], t_def["longitude"], postgres),
            is_demo=True,
        )
        db.add(t)
        inserted["telemetry_records"] += 1

    # Phase 3: Forest Officers roster (no fabricated phone numbers; opt-in channels default disabled)
    officer_defs = [
        {
            "name": "RFO Suresh Kumar",
            "badge_number": "KFD-BDP-RFO-101",
            "role": "Range Forest Officer (RFO)",
            "forest_range": "Hediyala Range",
            "district": "Bandipur Division",
            "latitude": 11.6635,
            "longitude": 76.6205,
            "whatsapp_opt_in": False,
            "sms_opt_in": False,
            "contact_channel": "whatsapp_stub",
            "duty_status": "On Duty",
            "on_duty": True,
            "notification_enabled": True,
        },
        {
            "name": "Dr. Anjali Rao",
            "badge_number": "KFD-BDP-VET-104",
            "role": "Wildlife Biologist & Vet",
            "forest_range": "Gundlupet Buffer",
            "district": "Bandipur Division",
            "latitude": 11.6885,
            "longitude": 76.6420,
            "whatsapp_opt_in": False,
            "sms_opt_in": False,
            "contact_channel": "whatsapp_stub",
            "duty_status": "On Duty",
            "on_duty": True,
            "notification_enabled": True,
        },
        {
            "name": "Beat Guard M. Basavaraj",
            "badge_number": "KFD-BDP-BG-209",
            "role": "Beat Guard",
            "forest_range": "Omkar Range",
            "district": "Bandipur Division",
            "latitude": 11.6400,
            "longitude": 76.5900,
            "whatsapp_opt_in": False,
            "sms_opt_in": False,
            "contact_channel": "sms_stub",
            "duty_status": "Patrol Active",
            "on_duty": True,
            "notification_enabled": True,
        },
        {
            "name": "RFO R. Nair",
            "badge_number": "KFD-BDP-RFO-108",
            "role": "Range Forest Officer (RFO)",
            "forest_range": "Maddur Range",
            "district": "Bandipur Division",
            "latitude": 11.7110,
            "longitude": 76.6260,
            "whatsapp_opt_in": False,
            "sms_opt_in": False,
            "contact_channel": "whatsapp_stub",
            "duty_status": "On Duty",
            "on_duty": True,
            "notification_enabled": True,
        },
    ]
    for o_def in officer_defs:
        exists = db.execute(
            select(ForestOfficer).where(ForestOfficer.badge_number == o_def["badge_number"])
        ).scalar_one_or_none()
        if exists:
            continue
        db.add(ForestOfficer(**o_def))
        inserted["forest_officers"] += 1

    # Phase 3: Configurable Alert Rules (only trigger on detections matching species/zone/repeat criteria)
    rule_defs = [
        {
            "name": "Bengal Tiger Perimeter Alert",
            "species_filter": "Bengal Tiger",
            "risk_level": "Critical",
            "village_id": None,
            "zone_name": None,
            "min_repeat_count": 1,
            "time_window_minutes": 180,
            "min_species_confidence": 0.60,
            "enabled": True,
            "auto_notify_officer": True,
            "auto_dispatch_iot_boundary": True,
            "description": "Triggers immediately when a Bengal Tiger is identified near a camera or fringe settlement above 60% confidence.",
        },
        {
            "name": "Repeat Individual Elephant Boundary Approach",
            "species_filter": "Asian Elephant",
            "risk_level": "High",
            "village_id": None,
            "zone_name": None,
            "min_repeat_count": 2,
            "time_window_minutes": 120,
            "min_species_confidence": 0.50,
            "enabled": True,
            "auto_notify_officer": True,
            "auto_dispatch_iot_boundary": True,
            "description": "Triggers when the same individual Asian Elephant (via Re-ID) is sighted >=2 times within 120 minutes near settlements.",
        },
        {
            "name": "Indian Leopard Livestock Corridor Alert",
            "species_filter": "Indian Leopard",
            "risk_level": "High",
            "village_id": None,
            "zone_name": None,
            "min_repeat_count": 1,
            "time_window_minutes": 180,
            "min_species_confidence": 0.55,
            "enabled": True,
            "auto_notify_officer": True,
            "auto_dispatch_iot_boundary": False,
            "description": "Triggers for Indian Leopard detections near monitored fringe zones.",
        },
    ]
    for r_def in rule_defs:
        exists = db.execute(
            select(AlertRule).where(AlertRule.name == r_def["name"])
        ).scalar_one_or_none()
        if exists:
            continue
        db.add(AlertRule(**r_def))
        inserted["alert_rules"] += 1

    db.commit()
    logger.info("Demo seeding complete: %s", inserted)
    return inserted


if __name__ == "__main__":
    with SessionLocal() as session:
        summary = seed_demo_data(session)
        print("Seeded demo records (is_demo=True):", summary)
