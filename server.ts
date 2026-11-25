import express, { Request, Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const API_PREFIX = (process.env.API_V1_PREFIX || '/api/v1').replace(/\/+$/, '');
const CONTROL_PLANE_PORT = process.env.CONTROL_PLANE_PORT
  ? Number(process.env.CONTROL_PLANE_PORT)
  : null;
const FASTAPI_SIDECAR_HOST = process.env.FASTAPI_SIDECAR_HOST || '127.0.0.1';
const REQUESTED_SIDECAR_PORT = Number(process.env.FASTAPI_SIDECAR_PORT || 8001);
const FASTAPI_SIDECAR_PORT =
  CONTROL_PLANE_PORT !== null && REQUESTED_SIDECAR_PORT === CONTROL_PLANE_PORT
    ? CONTROL_PLANE_PORT + 1
    : REQUESTED_SIDECAR_PORT;

function isLoopbackHost(hostname: string): boolean {
  const norm = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  return norm === '127.0.0.1' || norm === 'localhost' || norm === '0.0.0.0' || norm === '::1';
}

function resolveFastApiSidecarConfig(): { url: string; hasExternalSidecar: boolean } {
  const fallbackLocalUrl = `http://${FASTAPI_SIDECAR_HOST}:${FASTAPI_SIDECAR_PORT}`;
  const rawEnvUrl = (process.env.FASTAPI_SIDECAR_URL || '').trim();
  if (!rawEnvUrl) {
    return { url: fallbackLocalUrl, hasExternalSidecar: false };
  }
  try {
    const parsed = new URL(rawEnvUrl);
    const effectivePort = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
      ? 443
      : 80;
    if (
      CONTROL_PLANE_PORT !== null &&
      isLoopbackHost(parsed.hostname) &&
      effectivePort === CONTROL_PLANE_PORT
    ) {
      console.warn(
        `[WICPS] Ignoring FASTAPI_SIDECAR_URL=${rawEnvUrl} because port ${CONTROL_PLANE_PORT} is reserved by platform CONTROL_PLANE_PORT; using local FastAPI sidecar at ${fallbackLocalUrl}.`
      );
      return { url: fallbackLocalUrl, hasExternalSidecar: false };
    }
    return { url: rawEnvUrl.replace(/\/+$/, ''), hasExternalSidecar: true };
  } catch {
    return { url: fallbackLocalUrl, hasExternalSidecar: false };
  }
}

const SIDECAR_CONFIG = resolveFastApiSidecarConfig();
const FASTAPI_SIDECAR_URL = SIDECAR_CONFIG.url;
const HAS_EXTERNAL_FASTAPI_SIDECAR = SIDECAR_CONFIG.hasExternalSidecar;
let fastApiProcess: ChildProcess | null = null;

// --- Domain Types (snake_case DTOs matching FastAPI backend) ---
interface VillageRecord {
  id: string;
  name: string;
  district: string;
  forest_range: string;
  population: number;
  households: number;
  forest_distance_km: number;
  latitude: number;
  longitude: number;
  risk_level: string;
  risk_score: number;
  active_solar_fence: boolean;
  fence_status: string;
  assigned_rrt: string;
  emergency_contact: string;
  recent_incidents_30d: number;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

interface RiskZoneRecord {
  id: string;
  name: string;
  district: string;
  forest_range: string;
  village_id: string | null;
  risk_level: string;
  risk_score: number;
  dominant_species: string;
  center_lat: number;
  center_lng: number;
  polygon_coordinates: [number, number][];
  active_alert_count: number;
  primary_risk_factor: string;
  is_demo: boolean;
}

interface IncidentRecord {
  id: string;
  incident_code: string;
  species: string;
  date_time: string;
  latitude: number;
  longitude: number;
  village_id: string | null;
  village: string;
  district: string;
  forest_range: string;
  incident_type: string;
  severity: string;
  human_injury: string;
  human_injuries_count: number;
  livestock_loss_count: number;
  crop_damage_estimated_acres: number;
  crop_type: string | null;
  description: string;
  image_url: string | null;
  status: string;
  reported_by: string;
  assigned_officer: string | null;
  action_taken: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

interface SightingRecord {
  id: string;
  sighting_code: string;
  species: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  location_name: string;
  district: string;
  forest_range: string;
  herd_size: number;
  movement_direction: string;
  bearing_degrees: number;
  behavior: string;
  juveniles_present: boolean;
  observation_details: string;
  observer_name: string;
  observer_role: string;
  verified_by_forest_guard: boolean;
  photo_url: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

interface AlertRecord {
  id: string;
  title: string;
  message: string;
  severity: string;
  species: string;
  affected_village: string;
  village_id: string | null;
  district: string;
  latitude: number;
  longitude: number;
  alert_time: string;
  triggered_at: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  assigned_officer: string | null;
  response_status: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

interface PatrolRecord {
  id: string;
  patrol_code: string;
  team_name: string;
  lead_officer: string;
  target_area: string;
  sector: string;
  district: string;
  village_id: string | null;
  priority: string;
  status: string;
  scheduled_window: string;
  active_personnel: number;
  equipment: string[];
  risk_rationale: string;
  approved_by: string;
  latitude: number;
  longitude: number;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

// --- Helpers ---
const DIRECTION_TO_BEARING: Record<string, number> = {
  North: 0,
  'North-East': 45,
  East: 90,
  'South-East': 135,
  South: 180,
  'South-West': 225,
  West: 270,
  'North-West': 315,
  Stationary: 0,
};

const DIVISION_KEYWORDS: Record<string, string[]> = {
  'hediyala range': ['hediyala', 'kadambur', 'solakarai', 'sector 4b'],
  'gundlupet buffer': ['gundlupet', 'mangala'],
  'maddur range': ['maddur', 'berambadi'],
  'omkar range': ['omkar'],
  'gs betta range': ['gs betta', 'gopalaswamy'],
};

function resolveBearing(direction: string, explicit?: number | null): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  return DIRECTION_TO_BEARING[direction] ?? 0;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0088;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function matchesDivision(division: string | undefined, fields: (string | undefined | null)[]): boolean {
  if (!division) return true;
  const normalized = division.trim().toLowerCase();
  if (!normalized || normalized === 'all' || normalized === 'bandipur division') return true;
  const keywords = DIVISION_KEYWORDS[normalized] ?? [normalized];
  return keywords.some((kw) =>
    fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(kw))
  );
}

function matchesDateWindow(
  isoValue: string,
  dateFrom?: string,
  dateTo?: string,
  dateRange?: string
): boolean {
  const ts = Date.parse(isoValue);
  if (Number.isNaN(ts)) return true;
  if (dateFrom) {
    const fromTs = Date.parse(dateFrom);
    if (!Number.isNaN(fromTs) && ts < fromTs) return false;
  }
  if (dateTo) {
    const toTs = Date.parse(dateTo);
    if (!Number.isNaN(toTs) && ts > toTs) return false;
  }
  if (dateRange) {
    const norm = dateRange.trim();
    const now = Date.now();
    if (norm === 'Live (Last 24 Hours)' || norm === 'Last 24 Hours') {
      if (ts < now - 24 * 3600 * 1000) return false;
    } else if (norm === 'Last 7 Days') {
      if (ts < now - 7 * 24 * 3600 * 1000) return false;
    } else if (norm === 'Last 30 Days') {
      if (ts < now - 30 * 24 * 3600 * 1000) return false;
    }
  }
  return true;
}

function paginate<T>(items: T[], rawPage: unknown, rawPageSize: unknown) {
  const page = Math.max(1, Number(rawPage) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(rawPageSize) || 50));
  const total = items.length;
  const totalPages = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    total,
    page,
    page_size: pageSize,
    total_pages: totalPages,
  };
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600 * 1000).toISOString();
}

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
}

function minsAgo(m: number): string {
  return new Date(Date.now() - m * 60 * 1000).toISOString();
}

// --- In-Memory Seeded Store (mirrors backend/app/services/seed.py) ---
function createSeedData() {
  const nowIso = new Date().toISOString();

  const villages: VillageRecord[] = [
    {
      id: crypto.randomUUID(),
      name: 'Kadambur Fringe',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range',
      population: 1420,
      households: 285,
      forest_distance_km: 0.35,
      latitude: 11.664,
      longitude: 76.622,
      risk_level: 'Critical',
      risk_score: 89,
      active_solar_fence: true,
      fence_status: 'Breached',
      assigned_rrt: 'Hediyala Sector QRT-1',
      emergency_contact: '+91 821 240 1926 (Panchayat Base)',
      recent_incidents_30d: 7,
      is_demo: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: crypto.randomUUID(),
      name: 'Mangala Settlement',
      district: 'Bandipur Division',
      forest_range: 'Gundlupet Buffer',
      population: 860,
      households: 172,
      forest_distance_km: 0.6,
      latitude: 11.688,
      longitude: 76.643,
      risk_level: 'Critical',
      risk_score: 84,
      active_solar_fence: true,
      fence_status: 'Maintenance Required',
      assigned_rrt: 'Gundlupet QRT-2',
      emergency_contact: '+91 821 240 1928',
      recent_incidents_30d: 5,
      is_demo: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: crypto.randomUUID(),
      name: 'Omkar Forest Fringe',
      district: 'Bandipur Division',
      forest_range: 'Omkar Range',
      population: 1120,
      households: 230,
      forest_distance_km: 0.8,
      latitude: 11.639,
      longitude: 76.592,
      risk_level: 'High',
      risk_score: 72,
      active_solar_fence: true,
      fence_status: 'Operational',
      assigned_rrt: 'Omkar Beat Mobile Squad',
      emergency_contact: '+91 821 240 1930',
      recent_incidents_30d: 4,
      is_demo: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: crypto.randomUUID(),
      name: 'Berambadi Village',
      district: 'Bandipur Division',
      forest_range: 'Maddur Range',
      population: 2300,
      households: 490,
      forest_distance_km: 1.4,
      latitude: 11.712,
      longitude: 76.627,
      risk_level: 'High',
      risk_score: 68,
      active_solar_fence: false,
      fence_status: 'Maintenance Required',
      assigned_rrt: 'Maddur Emergency Unit',
      emergency_contact: '+91 821 240 1934',
      recent_incidents_30d: 3,
      is_demo: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: crypto.randomUUID(),
      name: 'Solakarai Colony',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range',
      population: 640,
      households: 120,
      forest_distance_km: 0.25,
      latitude: 11.676,
      longitude: 76.565,
      risk_level: 'Moderate',
      risk_score: 54,
      active_solar_fence: true,
      fence_status: 'Operational',
      assigned_rrt: 'Hediyala Sector QRT-1',
      emergency_contact: '+91 821 240 1936',
      recent_incidents_30d: 2,
      is_demo: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: crypto.randomUUID(),
      name: 'Maddur Colony',
      district: 'Bandipur Division',
      forest_range: 'Maddur Range',
      population: 1750,
      households: 360,
      forest_distance_km: 1.1,
      latitude: 11.622,
      longitude: 76.635,
      risk_level: 'Moderate',
      risk_score: 48,
      active_solar_fence: true,
      fence_status: 'Operational',
      assigned_rrt: 'Maddur Range Patrol',
      emergency_contact: '+91 821 240 1940',
      recent_incidents_30d: 2,
      is_demo: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      id: crypto.randomUUID(),
      name: 'Gopalaswamy Base',
      district: 'Bandipur Division',
      forest_range: 'GS Betta Range',
      population: 520,
      households: 98,
      forest_distance_km: 2.1,
      latitude: 11.726,
      longitude: 76.598,
      risk_level: 'Low',
      risk_score: 26,
      active_solar_fence: true,
      fence_status: 'Operational',
      assigned_rrt: 'GS Betta Unit',
      emergency_contact: '+91 821 240 1944',
      recent_incidents_30d: 1,
      is_demo: true,
      created_at: nowIso,
      updated_at: nowIso,
    },
  ];

  const byName = new Map(villages.map((v) => [v.name, v.id]));

  const riskZones: RiskZoneRecord[] = [
    {
      id: crypto.randomUUID(),
      name: 'Sector 4B Northern Wildlife Corridor',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range',
      village_id: byName.get('Kadambur Fringe') ?? null,
      risk_level: 'Critical',
      risk_score: 92,
      dominant_species: 'Asian Elephant',
      center_lat: 11.665,
      center_lng: 76.615,
      polygon_coordinates: [
        [11.65, 76.595],
        [11.68, 76.605],
        [11.685, 76.635],
        [11.655, 76.63],
      ],
      active_alert_count: 2,
      primary_risk_factor: 'Ripe sugarcane + dry stream bed funneling herds directly into Kadambur',
      is_demo: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Gundlupet Buffer Predation Pocket',
      district: 'Bandipur Division',
      forest_range: 'Gundlupet Buffer',
      village_id: byName.get('Mangala Settlement') ?? null,
      risk_level: 'High',
      risk_score: 78,
      dominant_species: 'Indian Leopard',
      center_lat: 11.692,
      center_lng: 76.635,
      polygon_coordinates: [
        [11.68, 76.62],
        [11.71, 76.63],
        [11.705, 76.655],
        [11.675, 76.645],
      ],
      active_alert_count: 1,
      primary_risk_factor: 'Dense lantana weed clusters providing stealth cover right up to backyard cattle sheds',
      is_demo: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Maddur Highway & Elephant Pass',
      district: 'Bandipur Division',
      forest_range: 'Maddur Range',
      village_id: byName.get('Maddur Colony') ?? null,
      risk_level: 'High',
      risk_score: 71,
      dominant_species: 'Asian Elephant',
      center_lat: 11.628,
      center_lng: 76.625,
      polygon_coordinates: [
        [11.615, 76.61],
        [11.64, 76.615],
        [11.635, 76.645],
        [11.61, 76.638],
      ],
      active_alert_count: 1,
      primary_risk_factor: 'Traditional linear migration route bisected by state highway and overhead powerlines',
      is_demo: true,
    },
    {
      id: crypto.randomUUID(),
      name: 'Omkar Western Sanctuary Fringe',
      district: 'Bandipur Division',
      forest_range: 'Omkar Range',
      village_id: byName.get('Omkar Forest Fringe') ?? null,
      risk_level: 'Moderate',
      risk_score: 56,
      dominant_species: 'Bengal Tiger',
      center_lat: 11.642,
      center_lng: 76.585,
      polygon_coordinates: [
        [11.63, 76.57],
        [11.66, 76.575],
        [11.655, 76.6],
        [11.625, 76.592],
      ],
      active_alert_count: 0,
      primary_risk_factor: 'Occasional buffer perimeter incursions by dispersing young adult carnivores',
      is_demo: true,
    },
  ];

  const incidents: IncidentRecord[] = [
    {
      id: crypto.randomUUID(),
      incident_code: 'WICPS-2026-089',
      species: 'Asian Elephant',
      date_time: hoursAgo(8),
      latitude: 11.6624,
      longitude: 76.6189,
      village_id: byName.get('Kadambur Fringe') ?? null,
      village: 'Kadambur Fringe',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range (Beat 4)',
      incident_type: 'Crop Depredation',
      severity: 'High',
      human_injury: 'None',
      human_injuries_count: 0,
      livestock_loss_count: 0,
      crop_damage_estimated_acres: 3.8,
      crop_type: 'Mature Sugarcane & Paddy',
      description:
        'A herd of 7 elephants, including 2 sub-adults, breached the solar fence at pylon 54 and entered agricultural plots. Forest QRT fired blank rounds to drive them back towards the teak reserve.',
      image_url: 'https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80',
      status: 'Patrol Dispatched',
      reported_by: 'Range Forest Officer Suresh Kumar',
      assigned_officer: 'RFO S. Kumar (QRT-1)',
      action_taken: 'Crackers & spotlight deployment. Solar fence repair order issued.',
      is_demo: true,
      created_at: hoursAgo(8),
      updated_at: hoursAgo(8),
    },
    {
      id: crypto.randomUUID(),
      incident_code: 'WICPS-2026-088',
      species: 'Indian Leopard',
      date_time: hoursAgo(14),
      latitude: 11.6892,
      longitude: 76.6412,
      village_id: byName.get('Mangala Settlement') ?? null,
      village: 'Mangala Settlement',
      district: 'Bandipur Division',
      forest_range: 'Gundlupet Buffer',
      incident_type: 'Livestock Predation',
      severity: 'Critical',
      human_injury: 'Minor',
      human_injuries_count: 1,
      livestock_loss_count: 2,
      crop_damage_estimated_acres: 0.0,
      crop_type: null,
      description:
        'Male leopard ambushed a cattle pen behind a farm house. A shepherd sustained minor forearm scratches while sounding metal alarm plates. Leopard retreated into lantana bushes.',
      image_url: 'https://images.unsplash.com/photo-1456926631375-92c8ce872def?auto=format&fit=crop&w=800&q=80',
      status: 'Under Control',
      reported_by: 'Village Panchayat President',
      assigned_officer: 'Veterinary Officer Dr. Anjali Rao',
      action_taken: 'Cage trap deployed at GPS waypoint LP-02; shepherd provided first aid at primary health centre.',
      is_demo: true,
      created_at: hoursAgo(14),
      updated_at: hoursAgo(14),
    },
    {
      id: crypto.randomUUID(),
      incident_code: 'WICPS-2026-087',
      species: 'Bengal Tiger',
      date_time: daysAgo(2),
      latitude: 11.6415,
      longitude: 76.5891,
      village_id: byName.get('Omkar Forest Fringe') ?? null,
      village: 'Omkar Forest Fringe',
      district: 'Bandipur Division',
      forest_range: 'Omkar Range',
      incident_type: 'Village Incursion',
      severity: 'High',
      human_injury: 'None',
      human_injuries_count: 0,
      livestock_loss_count: 1,
      crop_damage_estimated_acres: 0.0,
      crop_type: null,
      description:
        'Sub-adult female tiger sighted near the village water tank. Tiger dragged a goat towards boundary nullah. Thermal drone deployed to verify boundary return.',
      image_url: 'https://images.unsplash.com/photo-1561731216-c3a4d99437d5?auto=format&fit=crop&w=800&q=80',
      status: 'Verified',
      reported_by: 'Beat Guard M. Basavaraj',
      assigned_officer: 'Beat Guard M. Basavaraj',
      action_taken: 'Thermal drone monitoring initiated. Villagers advised to avoid peripheral grazing for 48 hrs.',
      is_demo: true,
      created_at: daysAgo(2),
      updated_at: daysAgo(2),
    },
    {
      id: crypto.randomUUID(),
      incident_code: 'WICPS-2026-086',
      species: 'Sloth Bear',
      date_time: daysAgo(3),
      latitude: 11.7105,
      longitude: 76.625,
      village_id: byName.get('Berambadi Village') ?? null,
      village: 'Berambadi Village',
      district: 'Bandipur Division',
      forest_range: 'Maddur Range',
      incident_type: 'Human Injury / Attack',
      severity: 'Critical',
      human_injury: 'Severe',
      human_injuries_count: 1,
      livestock_loss_count: 0,
      crop_damage_estimated_acres: 0.5,
      crop_type: 'Maize field & Banana trees',
      description:
        'Farmer returning after nocturnal borewell operation encountered a mother sloth bear with cubs feeding on fallen honeycomb and maize. Farmer sustained deep lacerations. Rapid medical evacuation conducted.',
      image_url: 'https://images.unsplash.com/photo-1589656966895-2f33e7653819?auto=format&fit=crop&w=800&q=80',
      status: 'Resolved',
      reported_by: 'Emergency Toll-free 1926 Call',
      assigned_officer: 'Assistant Conservator of Forests K. Gowda',
      action_taken: 'Immediate ex-gratia compensation processed (Rs 50,000 provisional); night patrol doubled.',
      is_demo: true,
      created_at: daysAgo(3),
      updated_at: daysAgo(3),
    },
    {
      id: crypto.randomUUID(),
      incident_code: 'WICPS-2026-085',
      species: 'Wild Boar',
      date_time: daysAgo(4),
      latitude: 11.678,
      longitude: 76.562,
      village_id: byName.get('Solakarai Colony') ?? null,
      village: 'Solakarai Settlement',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range',
      incident_type: 'Crop Depredation',
      severity: 'Moderate',
      human_injury: 'None',
      human_injuries_count: 0,
      livestock_loss_count: 0,
      crop_damage_estimated_acres: 2.1,
      crop_type: 'Groundnut & Potato',
      description:
        'Sounder of approximately 14 wild boars rooted up newly seeded tuber crops. Elephant-proof trench was silted up at this sector enabling crossing.',
      image_url: 'https://images.unsplash.com/photo-1547407139-3c921a66005c?auto=format&fit=crop&w=800&q=80',
      status: 'Resolved',
      reported_by: 'Village Forest Committee',
      assigned_officer: 'Range Officer R. Nair',
      action_taken: 'Excavator dispatched to re-desilt 120m of trench perimeter.',
      is_demo: true,
      created_at: daysAgo(4),
      updated_at: daysAgo(4),
    },
    {
      id: crypto.randomUUID(),
      incident_code: 'WICPS-2026-084',
      species: 'Asian Elephant',
      date_time: daysAgo(5),
      latitude: 11.625,
      longitude: 76.632,
      village_id: byName.get('Maddur Colony') ?? null,
      village: 'Maddur Colony',
      district: 'Bandipur Division',
      forest_range: 'Maddur Range',
      incident_type: 'Infrastructure Breach',
      severity: 'High',
      human_injury: 'None',
      human_injuries_count: 0,
      livestock_loss_count: 0,
      crop_damage_estimated_acres: 1.2,
      crop_type: 'Banana Plantations',
      description:
        'Solitary tusker (Makhna) pushed over two concrete electrical poles causing localized blackout, then browsed through banana orchard.',
      image_url: 'https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80',
      status: 'Closed',
      reported_by: 'Electricity Board Lineman',
      assigned_officer: 'RFO S. Kumar (QRT-1)',
      action_taken: 'Power shut down immediately by substation; tusker steered back by elephant drive squad.',
      is_demo: true,
      created_at: daysAgo(5),
      updated_at: daysAgo(5),
    },
    {
      id: crypto.randomUUID(),
      incident_code: 'WICPS-2026-083',
      species: 'Gaur',
      date_time: daysAgo(10),
      latitude: 11.724,
      longitude: 76.595,
      village_id: byName.get('Gopalaswamy Base') ?? null,
      village: 'Gopalaswamy Foothills',
      district: 'Bandipur Division',
      forest_range: 'GS Betta Range',
      incident_type: 'Village Incursion',
      severity: 'Low',
      human_injury: 'None',
      human_injuries_count: 0,
      livestock_loss_count: 0,
      crop_damage_estimated_acres: 0.4,
      crop_type: null,
      description:
        'Three Indian Gaur browsed grass along temple approach road. No aggression displayed; moved back into reserve spontaneously upon vehicle traffic.',
      image_url: 'https://images.unsplash.com/photo-1534188753412-3e26d0d618d6?auto=format&fit=crop&w=800&q=80',
      status: 'Closed',
      reported_by: 'Tourist Beat Guard',
      assigned_officer: 'Beat Guard P. Murthy',
      action_taken: 'Vehicular speed limit enforced on temple road.',
      is_demo: true,
      created_at: daysAgo(10),
      updated_at: daysAgo(10),
    },
  ];

  const sightings: SightingRecord[] = [
    {
      id: crypto.randomUUID(),
      sighting_code: 'SIGHT-2026-312',
      species: 'Asian Elephant',
      timestamp: hoursAgo(3),
      latitude: 11.668,
      longitude: 76.612,
      location_name: 'Sector 4B Stream Checkdam',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range',
      herd_size: 8,
      movement_direction: 'North-East',
      bearing_degrees: 45,
      behavior: 'Moving towards village',
      juveniles_present: true,
      observation_details:
        'Family group moving deliberately along stream line towards Kadambur paddy outskirts. Leading matriarch with radio collar #EL-04 visible.',
      observer_name: 'Beat Guard Ramesh K.',
      observer_role: 'Forest Guard (Beat 4)',
      verified_by_forest_guard: true,
      photo_url: 'https://images.unsplash.com/photo-1557050543-4d5f4e07ef46?auto=format&fit=crop&w=800&q=80',
      is_demo: true,
      created_at: hoursAgo(3),
      updated_at: hoursAgo(3),
    },
    {
      id: crypto.randomUUID(),
      sighting_code: 'SIGHT-2026-311',
      species: 'Indian Leopard',
      timestamp: hoursAgo(9),
      latitude: 11.691,
      longitude: 76.638,
      location_name: 'Rocky Escarpment near Mangala',
      district: 'Bandipur Division',
      forest_range: 'Gundlupet Buffer',
      herd_size: 1,
      movement_direction: 'West',
      bearing_degrees: 270,
      behavior: 'Foraging',
      juveniles_present: false,
      observation_details:
        'Automated camera trap #CT-18 triggered. Adult male stalking along dry boulder gully 350m from goat sheds.',
      observer_name: 'Camera Trap AI Sensor #CT-18',
      observer_role: 'Automated Grid Camera',
      verified_by_forest_guard: true,
      photo_url: null,
      is_demo: true,
      created_at: hoursAgo(9),
      updated_at: hoursAgo(9),
    },
    {
      id: crypto.randomUUID(),
      sighting_code: 'SIGHT-2026-310',
      species: 'Bengal Tiger',
      timestamp: hoursAgo(16),
      latitude: 11.635,
      longitude: 76.578,
      location_name: 'Omkar Perennial Salt Lick',
      district: 'Bandipur Division',
      forest_range: 'Omkar Range',
      herd_size: 1,
      movement_direction: 'Stationary',
      bearing_degrees: 0,
      behavior: 'Resting',
      juveniles_present: false,
      observation_details:
        'Healthy male tiger (Identified as T-114) resting in bamboo clump near natural salt lick. Pugs fresh.',
      observer_name: 'Wildlife Biologist Sneha Patil',
      observer_role: 'Field Biologist',
      verified_by_forest_guard: true,
      photo_url: null,
      is_demo: true,
      created_at: hoursAgo(16),
      updated_at: hoursAgo(16),
    },
    {
      id: crypto.randomUUID(),
      sighting_code: 'SIGHT-2026-309',
      species: 'Wild Boar',
      timestamp: daysAgo(2),
      latitude: 11.674,
      longitude: 76.559,
      location_name: 'Solakarai Wetland Margin',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range',
      herd_size: 18,
      movement_direction: 'East',
      bearing_degrees: 90,
      behavior: 'Foraging',
      juveniles_present: true,
      observation_details:
        'Large sounder rooting along swamp edge. High likelihood of crossing village boundary after nightfall.',
      observer_name: 'Forest Watcher Mahadeva',
      observer_role: 'Community Forest Watcher',
      verified_by_forest_guard: false,
      photo_url: null,
      is_demo: true,
      created_at: daysAgo(2),
      updated_at: daysAgo(2),
    },
    {
      id: crypto.randomUUID(),
      sighting_code: 'SIGHT-2026-308',
      species: 'Asian Elephant',
      timestamp: daysAgo(4),
      latitude: 11.619,
      longitude: 76.628,
      location_name: 'Maddur Elephant Corridor Link',
      district: 'Bandipur Division',
      forest_range: 'Maddur Range',
      herd_size: 2,
      movement_direction: 'South-East',
      bearing_degrees: 135,
      behavior: 'Moving towards village',
      juveniles_present: false,
      observation_details:
        'Two adult bulls crossing inter-reserve highway road cut. Vehicular traffic temporarily halted for 12 minutes.',
      observer_name: 'Highways Patrol Unit',
      observer_role: 'Inter-Agency Unit',
      verified_by_forest_guard: true,
      photo_url: null,
      is_demo: true,
      created_at: daysAgo(4),
      updated_at: daysAgo(4),
    },
  ];

  const alerts: AlertRecord[] = [
    {
      id: crypto.randomUUID(),
      title: 'CRITICAL: Elephant Herd Incursion Imminent',
      message:
        'Collar #EL-04 and 7 uncollared elephants detected 280m from Kadambur crop fence. Moving NE directly toward sugarcane fields.',
      severity: 'Critical',
      species: 'Asian Elephant',
      affected_village: 'Kadambur Fringe',
      village_id: byName.get('Kadambur Fringe') ?? null,
      district: 'Bandipur Division',
      latitude: 11.6624,
      longitude: 76.6189,
      alert_time: '18 mins ago (05:42 IST)',
      triggered_at: minsAgo(18),
      acknowledged: false,
      acknowledged_by: null,
      acknowledged_at: null,
      assigned_officer: 'RFO Suresh Kumar',
      response_status: 'RRT En Route',
      is_demo: true,
      created_at: minsAgo(18),
      updated_at: minsAgo(18),
    },
    {
      id: crypto.randomUUID(),
      title: 'HIGH: Leopard Sighted Near Mangala School Perimeter',
      message:
        'Camera trap CT-18 triggered twice in 40 minutes. Predator stalking perimeter cattle pen; school route caution advised.',
      severity: 'High',
      species: 'Indian Leopard',
      affected_village: 'Mangala Settlement',
      village_id: byName.get('Mangala Settlement') ?? null,
      district: 'Bandipur Division',
      latitude: 11.6892,
      longitude: 76.6412,
      alert_time: '1 hr 12 mins ago (04:48 IST)',
      triggered_at: minsAgo(72),
      acknowledged: true,
      acknowledged_by: 'DFO Wildlife Ops',
      acknowledged_at: minsAgo(60),
      assigned_officer: 'Veterinary Officer Dr. Anjali Rao',
      response_status: 'On Scene',
      is_demo: true,
      created_at: minsAgo(72),
      updated_at: minsAgo(60),
    },
    {
      id: crypto.randomUUID(),
      title: 'MODERATE: Sounder of Boars Encroaching Groundnut Plots',
      message:
        'Estimated 18 wild boars congregating near water drain; potential crop damage expected before dawn.',
      severity: 'Moderate',
      species: 'Wild Boar',
      affected_village: 'Solakarai Colony',
      village_id: byName.get('Solakarai Colony') ?? null,
      district: 'Bandipur Division',
      latitude: 11.678,
      longitude: 76.562,
      alert_time: '2 hrs 25 mins ago (03:35 IST)',
      triggered_at: minsAgo(145),
      acknowledged: true,
      acknowledged_by: 'RFO R. Nair',
      acknowledged_at: minsAgo(130),
      assigned_officer: 'RFO R. Nair',
      response_status: 'Pending Dispatch',
      is_demo: true,
      created_at: minsAgo(145),
      updated_at: minsAgo(130),
    },
    {
      id: crypto.randomUUID(),
      title: 'ADVISORY: Bull Elephant Near Inter-State Highway 76',
      message:
        'Makhna tusker observed grazing 40m from highway edge near Maddur. Traffic wardens alerted to enforce speed limit.',
      severity: 'Moderate',
      species: 'Asian Elephant',
      affected_village: 'Maddur Colony',
      village_id: byName.get('Maddur Colony') ?? null,
      district: 'Bandipur Division',
      latitude: 11.625,
      longitude: 76.632,
      alert_time: '4 hrs ago (02:00 IST)',
      triggered_at: hoursAgo(4),
      acknowledged: true,
      acknowledged_by: 'Beat Guard P. Murthy',
      acknowledged_at: minsAgo(225),
      assigned_officer: 'Beat Guard P. Murthy',
      response_status: 'Area Cleared',
      is_demo: true,
      created_at: hoursAgo(4),
      updated_at: minsAgo(225),
    },
  ];

  const patrols: PatrolRecord[] = [
    {
      id: crypto.randomUUID(),
      patrol_code: 'PTR-2026-081',
      team_name: 'QRT Alpha — Strike Tactical Vehicle',
      lead_officer: 'Captain K. Ravindran',
      target_area: 'Kadambur Agricultural Border & Stream Checkdam',
      sector: 'Sector 4B (Northern Corridor)',
      district: 'Bandipur Division',
      village_id: byName.get('Kadambur Fringe') ?? null,
      priority: 'Critical',
      status: 'In Progress',
      scheduled_window: '18:00 - 04:00 IST (Nocturnal)',
      active_personnel: 5,
      equipment: [
        'Thermal Vision Scope',
        'High-decibel Acoustic Siren',
        'Non-lethal Pyrotechnics',
        '4x4 Forest Defender Jeep',
      ],
      risk_rationale:
        'Direct interception for Asian Elephant herd (Collar #EL-04) near breached pylon 54',
      approved_by: 'Dr. Vikramaditya Sen, IFS (DFO)',
      latitude: 11.6624,
      longitude: 76.6189,
      is_demo: true,
      created_at: hoursAgo(5),
      updated_at: hoursAgo(5),
    },
    {
      id: crypto.randomUUID(),
      patrol_code: 'PTR-2026-082',
      team_name: 'Gundlupet Predator Containment Squad',
      lead_officer: 'Dr. Anjali Rao (Wildlife Biologist)',
      target_area: 'Mangala Settlement Outer Cattle Corrals',
      sector: 'Gundlupet Buffer Beat 02',
      district: 'Bandipur Division',
      village_id: byName.get('Mangala Settlement') ?? null,
      priority: 'High',
      status: 'On Station',
      scheduled_window: '19:30 - 03:00 IST',
      active_personnel: 4,
      equipment: [
        'Humane Box Trap #02',
        'Veterinary Tranquilizer Kit',
        'High-intensity Halogen Searchlights',
        'VHF Handset',
      ],
      risk_rationale: 'Active leopard predation on domestic livestock; school pathway safeguard',
      approved_by: 'Dr. Vikramaditya Sen, IFS (DFO)',
      latitude: 11.6892,
      longitude: 76.6412,
      is_demo: true,
      created_at: hoursAgo(6),
      updated_at: hoursAgo(6),
    },
    {
      id: crypto.randomUUID(),
      patrol_code: 'PTR-2026-083',
      team_name: 'Hediyala Range Perimeter Squad Charlie',
      lead_officer: 'Suresh Kumar, SFS (RFO)',
      target_area: 'Sector 4B Stream Gully & Solar Line Pylons 40-75',
      sector: 'Hediyala Range (Beats 3 & 4)',
      district: 'Bandipur Division',
      village_id: byName.get('Kadambur Fringe') ?? null,
      priority: 'High',
      status: 'Scheduled',
      scheduled_window: '14:00 - 18:30 IST (Pre-dusk sweep)',
      active_personnel: 6,
      equipment: [
        'Solar Fence Fault Meter',
        'Trench Clearance Shovels',
        'High-visibility Vest Gear',
      ],
      risk_rationale:
        'Preventive energizer inspection and elephant-proof trench clearance before night foraging',
      approved_by: 'Suresh Kumar, SFS (RFO)',
      latitude: 11.668,
      longitude: 76.612,
      is_demo: true,
      created_at: hoursAgo(7),
      updated_at: hoursAgo(7),
    },
    {
      id: crypto.randomUUID(),
      patrol_code: 'PTR-2026-084',
      team_name: 'Maddur Highway Wildlife Traffic Warden Unit',
      lead_officer: 'P. Murthy (Beat Guard)',
      target_area: 'Inter-State Highway 76 Corridor Link',
      sector: 'Maddur Beat 06',
      district: 'Bandipur Division',
      village_id: byName.get('Maddur Colony') ?? null,
      priority: 'Medium',
      status: 'In Progress',
      scheduled_window: 'Continuous 24h Rotation',
      active_personnel: 3,
      equipment: [
        'Radar Speed Gun',
        'Reflective LED Warning Batons',
        'Megaphone Public Address Unit',
      ],
      risk_rationale: 'Mitigate vehicular speed along traditional bull elephant crossing road cut',
      approved_by: 'Assistant Conservator of Forests K. Gowda',
      latitude: 11.625,
      longitude: 76.632,
      is_demo: true,
      created_at: hoursAgo(10),
      updated_at: hoursAgo(10),
    },
    {
      id: crypto.randomUUID(),
      patrol_code: 'PTR-2026-085',
      team_name: 'Omkar Core Sanctuary Foot Patrol',
      lead_officer: 'M. Basavaraj (Beat Guard)',
      target_area: 'Omkar Natural Salt Lick & Bamboo Fringe',
      sector: 'Omkar Beat 03',
      district: 'Bandipur Division',
      village_id: byName.get('Omkar Forest Fringe') ?? null,
      priority: 'Low',
      status: 'Completed',
      scheduled_window: '06:00 - 12:00 IST (Morning Shift)',
      active_personnel: 4,
      equipment: [
        'Garmin eTrex GPS Handheld',
        'Camera Trap Retrieval Kit',
        'Pugmark Plaster Kits',
      ],
      risk_rationale: 'Tiger T-114 territory monitoring and camera trap SD card harvesting',
      approved_by: 'Suresh Kumar, SFS (RFO)',
      latitude: 11.635,
      longitude: 76.578,
      is_demo: true,
      created_at: daysAgo(1),
      updated_at: daysAgo(1),
    },
  ];

  return { villages, riskZones, incidents, sightings, alerts, patrols };
}

const store = createSeedData();

// --- GeoJSON Builders ---
function incidentToGeoJSON(inc: IncidentRecord, distanceKm?: number) {
  const properties: Record<string, unknown> = {
    layer: 'incidents',
    id: inc.id,
    incident_code: inc.incident_code,
    species: inc.species,
    date_time: inc.date_time,
    village: inc.village,
    district: inc.district,
    forest_range: inc.forest_range,
    incident_type: inc.incident_type,
    severity: inc.severity,
    status: inc.status,
    human_injury: inc.human_injury,
    crop_damage_estimated_acres: inc.crop_damage_estimated_acres,
    is_demo: inc.is_demo,
  };
  if (distanceKm !== undefined) {
    properties.distance_km = Number(distanceKm.toFixed(3));
  }
  return {
    type: 'Feature',
    id: `incident:${inc.id}`,
    geometry: { type: 'Point', coordinates: [inc.longitude, inc.latitude] },
    properties,
  };
}

function sightingToGeoJSON(s: SightingRecord) {
  return {
    type: 'Feature',
    id: `sighting:${s.id}`,
    geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
    properties: {
      layer: 'sightings',
      id: s.id,
      sighting_code: s.sighting_code,
      species: s.species,
      timestamp: s.timestamp,
      location_name: s.location_name,
      district: s.district,
      forest_range: s.forest_range,
      herd_size: s.herd_size,
      movement_direction: s.movement_direction,
      bearing_degrees: s.bearing_degrees,
      behavior: s.behavior,
      verified_by_forest_guard: s.verified_by_forest_guard,
      is_demo: s.is_demo,
    },
  };
}

function villageToGeoJSON(v: VillageRecord) {
  return {
    type: 'Feature',
    id: `village:${v.id}`,
    geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
    properties: {
      layer: 'villages',
      id: v.id,
      name: v.name,
      district: v.district,
      forest_range: v.forest_range,
      risk_level: v.risk_level,
      risk_score: v.risk_score,
      active_solar_fence: v.active_solar_fence,
      fence_status: v.fence_status,
      assigned_rrt: v.assigned_rrt,
      is_demo: v.is_demo,
    },
  };
}

function riskZoneToGeoJSON(rz: RiskZoneRecord) {
  const ring = rz.polygon_coordinates.map((pt) => [pt[1], pt[0]]);
  if (ring.length > 0) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([...first]);
    }
  }
  return {
    type: 'Feature',
    id: `risk_zone:${rz.id}`,
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {
      layer: 'risk_zones',
      id: rz.id,
      name: rz.name,
      district: rz.district,
      forest_range: rz.forest_range,
      risk_level: rz.risk_level,
      risk_score: rz.risk_score,
      dominant_species: rz.dominant_species,
      center_lat: rz.center_lat,
      center_lng: rz.center_lng,
      active_alert_count: rz.active_alert_count,
      primary_risk_factor: rz.primary_risk_factor,
      is_demo: rz.is_demo,
    },
  };
}

function alertToGeoJSON(a: AlertRecord) {
  return {
    type: 'Feature',
    id: `alert:${a.id}`,
    geometry: { type: 'Point', coordinates: [a.longitude, a.latitude] },
    properties: {
      layer: 'alerts',
      id: a.id,
      title: a.title,
      severity: a.severity,
      species: a.species,
      affected_village: a.affected_village,
      district: a.district,
      acknowledged: a.acknowledged,
      response_status: a.response_status,
      is_demo: a.is_demo,
    },
  };
}

// --- Express App & API Router ---
const app = express();

// CORS headers (strictly restricted to configured origins; local origins allowed only outside production)
function getAllowedCorsOrigins(): Set<string> {
  const raw = process.env.CORS_ORIGINS || '';
  const origins = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  if (process.env.NODE_ENV !== 'production') {
    origins.add(`http://localhost:${PORT}`);
    origins.add(`http://127.0.0.1:${PORT}`);
    origins.add('http://localhost:5173');
    origins.add('http://127.0.0.1:5173');
  }
  return origins;
}

const allowedCorsOrigins = getAllowedCorsOrigins();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedCorsOrigins.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Camera-Key, Idempotency-Key');
  if (req.method === 'OPTIONS') {
    if (origin && !allowedCorsOrigins.has(origin)) {
      return res.sendStatus(403);
    }
    return res.sendStatus(204);
  }
  next();
});

function forwardToFastApiSidecar(req: Request, res: Response) {
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.FASTAPI_SIDECAR_URL &&
    process.env.WICPS_ENABLE_FASTAPI_SIDECAR !== 'true'
  ) {
    return res.status(503).json({
      detail:
        'Production backend requires the standalone Render FastAPI backend (set VITE_API_BASE_URL on Vercel or FASTAPI_SIDECAR_URL). Local SQLite/filesystem sidecar is disabled in production.',
    });
  }

  const targetUrl = new URL(req.originalUrl, FASTAPI_SIDECAR_URL);
  const forwardHeaders: http.OutgoingHttpHeaders = {
    host: targetUrl.host,
  };
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (value !== undefined && lower !== 'host' && lower !== 'connection') {
      forwardHeaders[key] = value;
    }
  }

  const proxyReq = http.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: forwardHeaders,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 502);
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        const lower = k.toLowerCase();
        if (
          v !== undefined &&
          lower !== 'transfer-encoding' &&
          lower !== 'connection' &&
          lower !== 'keep-alive'
        ) {
          res.setHeader(k, v);
        }
      }
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(503).json({
        detail: `FastAPI Intelligence service unavailable at ${FASTAPI_SIDECAR_URL}: ${err.message}`,
      });
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq, { end: true });
}

// Raw streaming proxy to FastAPI sidecar for Thermal Cameras, Ingestion, Animal Detection, Re-ID Intelligence & IoT.
// Mounted BEFORE express.json() so multipart/form-data (images/video) and raw payloads stream untouched.
app.use(
  [
    `${API_PREFIX}/auth`,
    `${API_PREFIX}/cameras`,
    `${API_PREFIX}/ingest`,
    `${API_PREFIX}/detections`,
    `${API_PREFIX}/animal-intelligence`,
    `${API_PREFIX}/iot`,
  ],
  (req: Request, res: Response) => forwardToFastApiSidecar(req, res)
);

// When FastAPI sidecar is running locally (or FASTAPI_SIDECAR_URL is configured), also route core
// geospatial/operational REST endpoints to FastAPI so Sightings, Alerts, Villages, and Incidents share the exact same DB.
app.use(
  [
    `${API_PREFIX}/incidents`,
    `${API_PREFIX}/sightings`,
    `${API_PREFIX}/alerts`,
    `${API_PREFIX}/patrols`,
    `${API_PREFIX}/villages`,
    `${API_PREFIX}/gis`,
    `${API_PREFIX}/health`,
  ],
  (req: Request, res: Response, next) => {
    if (fastApiProcess !== null || HAS_EXTERNAL_FASTAPI_SIDECAR) {
      return forwardToFastApiSidecar(req, res);
    }
    return next();
  }
);

app.use(express.json({ limit: '2mb' }));

const api = express.Router();

// Health endpoints
api.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: process.env.APP_NAME || 'WICPS Intelligence API (Node.js Bridge)',
    version: '1.0.0',
    environment: process.env.ENVIRONMENT || 'aistudio',
    timestamp: new Date().toISOString(),
    telemetry_coords_exposed: false,
  });
});

api.get('/health/database', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    connected: true,
    dialect: 'in-memory (Node.js Express)',
    postgis_enabled: false,
    postgis_version: null,
    counts: {
      incidents: store.incidents.length,
      sightings: store.sightings.length,
      villages: store.villages.length,
      risk_zones: store.riskZones.length,
      alerts: store.alerts.length,
      patrols: store.patrols.length,
      telemetry_records: 2,
    },
  });
});

// Incidents CRUD
api.get('/incidents', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const filtered = store.incidents
    .filter((item) =>
      matchesDivision(q.division || q.district, [item.district, item.forest_range, item.village])
    )
    .filter((item) =>
      !q.forest_range || q.forest_range === 'All'
        ? true
        : item.forest_range.toLowerCase().includes(q.forest_range.trim().toLowerCase())
    )
    .filter((item) => (!q.status || q.status === 'All' ? true : item.status === q.status))
    .filter((item) => (!q.species || q.species === 'All' ? true : item.species === q.species))
    .filter((item) => (!q.severity || q.severity === 'All' ? true : item.severity === q.severity))
    .filter((item) =>
      q.is_demo !== undefined ? item.is_demo === (q.is_demo === 'true') : true
    )
    .filter((item) => {
      if (!q.search || !q.search.trim()) return true;
      const term = q.search.trim().toLowerCase();
      return [
        item.incident_code,
        item.species,
        item.village,
        item.forest_range,
        item.description,
        item.incident_type,
      ].some((f) => f.toLowerCase().includes(term));
    })
    .filter((item) => matchesDateWindow(item.date_time, q.date_from, q.date_to, q.date_range))
    .sort((a, b) => Date.parse(b.date_time) - Date.parse(a.date_time));

  res.json(paginate(filtered, q.page, q.page_size));
});

api.get('/incidents/:id', (req: Request, res: Response) => {
  const record = store.incidents.find((i) => i.id === req.params.id);
  if (!record) return res.status(404).json({ detail: 'Incident not found.' });
  res.json(record);
});

function requireNonEmptyString(value: unknown, field: string): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return `${field} is required.`;
  }
  return null;
}

function validateCoordPair(latRaw: unknown, lngRaw: unknown): { lat: number; lng: number; error?: string } {
  const lat = typeof latRaw === 'number' ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === 'number' ? lngRaw : Number(lngRaw);
  if (latRaw === undefined || latRaw === null || latRaw === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { lat, lng, error: 'Valid latitude (-90 to 90) is required.' };
  }
  if (lngRaw === undefined || lngRaw === null || lngRaw === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { lat, lng, error: 'Valid longitude (-180 to 180) is required.' };
  }
  return { lat, lng };
}

function resolveVillageId(
  explicitVillageId: unknown,
  ...candidateTexts: unknown[]
): { villageId: string | null; error?: string } {
  if (typeof explicitVillageId === 'string' && explicitVillageId.trim()) {
    const trimmed = explicitVillageId.trim();
    const matched = store.villages.find((v) => v.id === trimmed);
    if (!matched) {
      return { villageId: null, error: 'Referenced village_id does not exist.' };
    }
    return { villageId: matched.id };
  }

  const texts = candidateTexts
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase());
  if (texts.length === 0) return { villageId: null };

  for (const text of texts) {
    const exact = store.villages.find((v) => v.name.trim().toLowerCase() === text);
    if (exact) return { villageId: exact.id };
  }

  const sortedVillages = [...store.villages].sort((a, b) => b.name.length - a.name.length);
  for (const text of texts) {
    const contained = sortedVillages.find((v) => text.includes(v.name.trim().toLowerCase()));
    if (contained) return { villageId: contained.id };
  }

  for (const text of texts) {
    const tokens = new Set(text.match(/[a-z0-9]+/g) ?? []);
    const tokenMatch = sortedVillages.find((v) => {
      const firstToken = (v.name.toLowerCase().match(/[a-z0-9]+/g) ?? [])[0];
      return Boolean(firstToken && firstToken.length >= 4 && tokens.has(firstToken));
    });
    if (tokenMatch) return { villageId: tokenMatch.id };
  }

  for (const text of texts) {
    const rangeMatches = store.villages.filter(
      (v) =>
        v.forest_range.trim() &&
        (v.forest_range.trim().toLowerCase() === text ||
          text.includes(v.forest_range.trim().toLowerCase()))
    );
    if (rangeMatches.length === 1) {
      return { villageId: rangeMatches[0].id };
    }
  }

  return { villageId: null };
}

api.post('/incidents', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const errors: string[] = [];
  for (const [key, label] of [
    ['species', 'species'],
    ['village', 'village'],
    ['district', 'district'],
    ['forest_range', 'forest_range'],
    ['incident_type', 'incident_type'],
    ['severity', 'severity'],
    ['human_injury', 'human_injury'],
    ['status', 'status'],
    ['reported_by', 'reported_by'],
    ['description', 'description'],
  ] as const) {
    const err = requireNonEmptyString(body[key], label);
    if (err) errors.push(err);
  }
  const coords = validateCoordPair(body.latitude, body.longitude);
  if (coords.error) errors.push(coords.error);
  const cropAcres =
    body.crop_damage_estimated_acres === undefined || body.crop_damage_estimated_acres === null
      ? 0
      : Number(body.crop_damage_estimated_acres);
  if (!Number.isFinite(cropAcres) || cropAcres < 0) {
    errors.push('crop_damage_estimated_acres must be 0 or greater.');
  }
  const injuriesCount =
    body.human_injuries_count === undefined || body.human_injuries_count === null
      ? 0
      : Number(body.human_injuries_count);
  if (!Number.isInteger(injuriesCount) || injuriesCount < 0 || injuriesCount > 1000) {
    errors.push('human_injuries_count must be an integer between 0 and 1000.');
  }
  const livestockCount =
    body.livestock_loss_count === undefined || body.livestock_loss_count === null
      ? 0
      : Number(body.livestock_loss_count);
  if (!Number.isInteger(livestockCount) || livestockCount < 0 || livestockCount > 10000) {
    errors.push('livestock_loss_count must be an integer between 0 and 10000.');
  }
  const fk = resolveVillageId(body.village_id, body.village);
  if (fk.error) errors.push(fk.error);
  if (errors.length > 0) {
    return res.status(422).json({ detail: errors.join(' ') });
  }

  const now = new Date().toISOString();
  const code =
    typeof body.incident_code === 'string' && body.incident_code.trim()
      ? body.incident_code.trim()
      : `WICPS-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const created: IncidentRecord = {
    id: crypto.randomUUID(),
    incident_code: code,
    species: String(body.species).trim(),
    date_time: typeof body.date_time === 'string' && body.date_time.trim() ? body.date_time.trim() : now,
    latitude: coords.lat,
    longitude: coords.lng,
    village_id: fk.villageId,
    village: String(body.village).trim(),
    district: String(body.district).trim(),
    forest_range: String(body.forest_range).trim(),
    incident_type: String(body.incident_type).trim(),
    severity: String(body.severity).trim(),
    human_injury: String(body.human_injury).trim(),
    human_injuries_count: injuriesCount,
    livestock_loss_count: livestockCount,
    crop_damage_estimated_acres: cropAcres,
    crop_type: typeof body.crop_type === 'string' && body.crop_type.trim() ? body.crop_type.trim() : null,
    description: String(body.description).trim(),
    image_url: typeof body.image_url === 'string' && body.image_url.trim() ? body.image_url.trim() : null,
    status: String(body.status).trim(),
    reported_by: String(body.reported_by).trim(),
    assigned_officer:
      typeof body.assigned_officer === 'string' && body.assigned_officer.trim()
        ? body.assigned_officer.trim()
        : null,
    action_taken:
      typeof body.action_taken === 'string' && body.action_taken.trim() ? body.action_taken.trim() : null,
    is_demo: false,
    created_at: now,
    updated_at: now,
  };
  store.incidents.unshift(created);
  res.status(201).json(created);
});

api.put('/incidents/:id', (req: Request, res: Response) => {
  const idx = store.incidents.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Incident not found.' });
  const prev = store.incidents[idx];
  const updates = req.body ?? {};
  const errors: string[] = [];

  for (const key of [
    'species',
    'village',
    'district',
    'forest_range',
    'incident_type',
    'severity',
    'human_injury',
    'status',
    'reported_by',
    'description',
  ] as const) {
    if (updates[key] !== undefined) {
      const err = requireNonEmptyString(updates[key], key);
      if (err) errors.push(err);
    }
  }

  let nextLat = prev.latitude;
  let nextLng = prev.longitude;
  if (updates.latitude !== undefined || updates.longitude !== undefined) {
    const coords = validateCoordPair(
      updates.latitude !== undefined ? updates.latitude : prev.latitude,
      updates.longitude !== undefined ? updates.longitude : prev.longitude
    );
    if (coords.error) errors.push(coords.error);
    nextLat = coords.lat;
    nextLng = coords.lng;
  }

  let nextCrop = prev.crop_damage_estimated_acres;
  if (updates.crop_damage_estimated_acres !== undefined) {
    const cropVal = Number(updates.crop_damage_estimated_acres);
    if (!Number.isFinite(cropVal) || cropVal < 0) {
      errors.push('crop_damage_estimated_acres must be 0 or greater.');
    } else {
      nextCrop = cropVal;
    }
  }

  let nextInjuries = prev.human_injuries_count;
  if (updates.human_injuries_count !== undefined) {
    const val = Number(updates.human_injuries_count);
    if (!Number.isInteger(val) || val < 0 || val > 1000) {
      errors.push('human_injuries_count must be an integer between 0 and 1000.');
    } else {
      nextInjuries = val;
    }
  }

  let nextLivestock = prev.livestock_loss_count;
  if (updates.livestock_loss_count !== undefined) {
    const val = Number(updates.livestock_loss_count);
    if (!Number.isInteger(val) || val < 0 || val > 10000) {
      errors.push('livestock_loss_count must be an integer between 0 and 10000.');
    } else {
      nextLivestock = val;
    }
  }

  const nextVillage =
    updates.village !== undefined ? String(updates.village).trim() : prev.village;
  let nextVillageId = prev.village_id;
  if ('village_id' in updates) {
    if (updates.village_id !== null && updates.village_id !== undefined) {
      const fk = resolveVillageId(updates.village_id);
      if (fk.error) errors.push(fk.error);
      nextVillageId = fk.villageId;
    } else if (updates.village !== undefined) {
      nextVillageId = resolveVillageId(null, nextVillage).villageId;
    } else {
      nextVillageId = null;
    }
  } else if (updates.village !== undefined) {
    nextVillageId = resolveVillageId(null, nextVillage).villageId;
  }

  if (errors.length > 0) {
    return res.status(422).json({ detail: errors.join(' ') });
  }

  const updated: IncidentRecord = {
    ...prev,
    species: updates.species !== undefined ? String(updates.species).trim() : prev.species,
    date_time:
      typeof updates.date_time === 'string' && updates.date_time.trim()
        ? updates.date_time.trim()
        : prev.date_time,
    latitude: nextLat,
    longitude: nextLng,
    village_id: nextVillageId,
    village: nextVillage,
    district: updates.district !== undefined ? String(updates.district).trim() : prev.district,
    forest_range:
      updates.forest_range !== undefined ? String(updates.forest_range).trim() : prev.forest_range,
    incident_type:
      updates.incident_type !== undefined
        ? String(updates.incident_type).trim()
        : prev.incident_type,
    severity: updates.severity !== undefined ? String(updates.severity).trim() : prev.severity,
    human_injury:
      updates.human_injury !== undefined ? String(updates.human_injury).trim() : prev.human_injury,
    human_injuries_count: nextInjuries,
    livestock_loss_count: nextLivestock,
    crop_damage_estimated_acres: nextCrop,
    crop_type:
      updates.crop_type !== undefined
        ? typeof updates.crop_type === 'string' && updates.crop_type.trim()
          ? updates.crop_type.trim()
          : null
        : prev.crop_type,
    description:
      updates.description !== undefined ? String(updates.description).trim() : prev.description,
    image_url:
      updates.image_url !== undefined
        ? typeof updates.image_url === 'string' && updates.image_url.trim()
          ? updates.image_url.trim()
          : null
        : prev.image_url,
    status: updates.status !== undefined ? String(updates.status).trim() : prev.status,
    reported_by:
      updates.reported_by !== undefined ? String(updates.reported_by).trim() : prev.reported_by,
    assigned_officer:
      updates.assigned_officer !== undefined
        ? typeof updates.assigned_officer === 'string' && updates.assigned_officer.trim()
          ? updates.assigned_officer.trim()
          : null
        : prev.assigned_officer,
    action_taken:
      updates.action_taken !== undefined
        ? typeof updates.action_taken === 'string' && updates.action_taken.trim()
          ? updates.action_taken.trim()
          : null
        : prev.action_taken,
    id: prev.id,
    updated_at: new Date().toISOString(),
  };
  store.incidents[idx] = updated;
  res.json(updated);
});

api.delete('/incidents/:id', (req: Request, res: Response) => {
  const idx = store.incidents.findIndex((i) => i.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Incident not found.' });
  store.incidents.splice(idx, 1);
  res.json({ status: 'deleted', id: req.params.id });
});

// Sightings CRUD
api.get('/sightings', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const filtered = store.sightings
    .filter((item) =>
      matchesDivision(q.division || q.district, [
        item.district,
        item.forest_range,
        item.location_name,
      ])
    )
    .filter((item) =>
      !q.forest_range || q.forest_range === 'All'
        ? true
        : item.forest_range.toLowerCase().includes(q.forest_range.trim().toLowerCase())
    )
    .filter((item) => (!q.species || q.species === 'All' ? true : item.species === q.species))
    .filter((item) =>
      q.is_demo !== undefined ? item.is_demo === (q.is_demo === 'true') : true
    )
    .filter((item) => {
      if (!q.search || !q.search.trim()) return true;
      const term = q.search.trim().toLowerCase();
      return [
        item.sighting_code,
        item.species,
        item.location_name,
        item.forest_range,
        item.observer_name,
        item.observation_details,
      ].some((f) => f.toLowerCase().includes(term));
    })
    .filter((item) => matchesDateWindow(item.timestamp, q.date_from, q.date_to, q.date_range))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  res.json(paginate(filtered, q.page, q.page_size));
});

api.get('/sightings/:id', (req: Request, res: Response) => {
  const record = store.sightings.find((s) => s.id === req.params.id);
  if (!record) return res.status(404).json({ detail: 'Sighting not found.' });
  res.json(record);
});

api.post('/sightings', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const errors: string[] = [];
  for (const [key, label] of [
    ['species', 'species'],
    ['location_name', 'location_name'],
    ['district', 'district'],
    ['forest_range', 'forest_range'],
    ['movement_direction', 'movement_direction'],
    ['behavior', 'behavior'],
    ['observation_details', 'observation_details'],
    ['observer_name', 'observer_name'],
    ['observer_role', 'observer_role'],
  ] as const) {
    const err = requireNonEmptyString(body[key], label);
    if (err) errors.push(err);
  }
  const coords = validateCoordPair(body.latitude, body.longitude);
  if (coords.error) errors.push(coords.error);
  const herdSize = Number(body.herd_size);
  if (!Number.isFinite(herdSize) || herdSize < 1 || herdSize > 500) {
    errors.push('herd_size must be between 1 and 500.');
  }
  if (errors.length > 0) {
    return res.status(422).json({ detail: errors.join(' ') });
  }

  const now = new Date().toISOString();
  const code =
    typeof body.sighting_code === 'string' && body.sighting_code.trim()
      ? body.sighting_code.trim()
      : `SIGHT-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const direction = String(body.movement_direction).trim();

  const created: SightingRecord = {
    id: crypto.randomUUID(),
    sighting_code: code,
    species: String(body.species).trim(),
    timestamp: typeof body.timestamp === 'string' && body.timestamp.trim() ? body.timestamp.trim() : now,
    latitude: coords.lat,
    longitude: coords.lng,
    location_name: String(body.location_name).trim(),
    district: String(body.district).trim(),
    forest_range: String(body.forest_range).trim(),
    herd_size: Math.round(herdSize),
    movement_direction: direction,
    bearing_degrees: resolveBearing(direction, body.bearing_degrees),
    behavior: String(body.behavior).trim(),
    juveniles_present: Boolean(body.juveniles_present),
    observation_details: String(body.observation_details).trim(),
    observer_name: String(body.observer_name).trim(),
    observer_role: String(body.observer_role).trim(),
    verified_by_forest_guard: Boolean(body.verified_by_forest_guard),
    photo_url: body.photo_url || null,
    is_demo: false,
    created_at: now,
    updated_at: now,
  };
  store.sightings.unshift(created);
  res.status(201).json(created);
});

api.put('/sightings/:id', (req: Request, res: Response) => {
  const idx = store.sightings.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Sighting not found.' });
  const prev = store.sightings[idx];
  const updates = req.body ?? {};
  const nextDirection = updates.movement_direction ?? prev.movement_direction;
  const nextBearing =
    updates.movement_direction !== undefined && updates.bearing_degrees === undefined
      ? resolveBearing(nextDirection, null)
      : updates.bearing_degrees ?? prev.bearing_degrees;

  const updated: SightingRecord = {
    ...prev,
    ...updates,
    id: prev.id,
    bearing_degrees: nextBearing,
    updated_at: new Date().toISOString(),
  };
  store.sightings[idx] = updated;
  res.json(updated);
});

api.delete('/sightings/:id', (req: Request, res: Response) => {
  const idx = store.sightings.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Sighting not found.' });
  store.sightings.splice(idx, 1);
  res.json({ status: 'deleted', id: req.params.id });
});

// Alerts CRUD
api.get('/alerts', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const filtered = store.alerts
    .filter((item) =>
      matchesDivision(q.division || q.district, [
        item.district,
        item.affected_village,
        item.title,
        item.message,
      ])
    )
    .filter((item) => (!q.severity || q.severity === 'All' ? true : item.severity === q.severity))
    .filter((item) =>
      q.acknowledged !== undefined ? item.acknowledged === (q.acknowledged === 'true') : true
    )
    .filter((item) =>
      !q.status || q.status === 'All' ? true : item.response_status === q.status
    )
    .filter((item) =>
      q.is_demo !== undefined ? item.is_demo === (q.is_demo === 'true') : true
    )
    .filter((item) => {
      if (!q.search || !q.search.trim()) return true;
      const term = q.search.trim().toLowerCase();
      return [item.title, item.message, item.affected_village, item.species].some((f) =>
        f.toLowerCase().includes(term)
      );
    })
    .filter((item) => matchesDateWindow(item.triggered_at, q.date_from, q.date_to, q.date_range))
    .sort((a, b) => {
      if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
      return Date.parse(b.triggered_at) - Date.parse(a.triggered_at);
    });

  res.json(paginate(filtered, q.page, q.page_size));
});

api.get('/alerts/:id', (req: Request, res: Response) => {
  const record = store.alerts.find((a) => a.id === req.params.id);
  if (!record) return res.status(404).json({ detail: 'Alert not found.' });
  res.json(record);
});

api.post('/alerts', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const errors: string[] = [];
  for (const [key, label] of [
    ['title', 'title'],
    ['message', 'message'],
    ['severity', 'severity'],
    ['species', 'species'],
    ['affected_village', 'affected_village'],
    ['district', 'district'],
    ['response_status', 'response_status'],
  ] as const) {
    const err = requireNonEmptyString(body[key], label);
    if (err) errors.push(err);
  }
  const coords = validateCoordPair(body.latitude, body.longitude);
  if (coords.error) errors.push(coords.error);
  if (errors.length > 0) {
    return res.status(422).json({ detail: errors.join(' ') });
  }

  const now = new Date().toISOString();
  const triggered =
    typeof body.triggered_at === 'string' && body.triggered_at.trim()
      ? body.triggered_at.trim()
      : now;
  const fk = resolveVillageId(body.village_id, body.affected_village);
  if (fk.error) {
    return res.status(422).json({ detail: fk.error });
  }

  const created: AlertRecord = {
    id: crypto.randomUUID(),
    title: String(body.title).trim(),
    message: String(body.message).trim(),
    severity: String(body.severity).trim(),
    species: String(body.species).trim(),
    affected_village: String(body.affected_village).trim(),
    village_id: fk.villageId,
    district: String(body.district).trim(),
    latitude: coords.lat,
    longitude: coords.lng,
    alert_time:
      body.alert_time ||
      `${triggered.slice(0, 16).replace('T', ' ')} UTC`,
    triggered_at: triggered,
    acknowledged: Boolean(body.acknowledged),
    acknowledged_by: body.acknowledged_by || null,
    acknowledged_at: body.acknowledged_at || (body.acknowledged ? now : null),
    assigned_officer: body.assigned_officer || null,
    response_status: String(body.response_status).trim(),
    is_demo: false,
    created_at: now,
    updated_at: now,
  };
  store.alerts.unshift(created);
  res.status(201).json(created);
});

api.put('/alerts/:id', (req: Request, res: Response) => {
  const idx = store.alerts.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Alert not found.' });
  const prev = store.alerts[idx];
  const updates = req.body ?? {};
  const now = new Date().toISOString();

  const nextAffectedVillage =
    updates.affected_village !== undefined
      ? String(updates.affected_village).trim()
      : prev.affected_village;
  let nextVillageId = prev.village_id;
  if ('village_id' in updates) {
    if (updates.village_id !== null && updates.village_id !== undefined) {
      const fk = resolveVillageId(updates.village_id);
      if (fk.error) return res.status(422).json({ detail: fk.error });
      nextVillageId = fk.villageId;
    } else if (updates.affected_village !== undefined) {
      nextVillageId = resolveVillageId(null, nextAffectedVillage).villageId;
    } else {
      nextVillageId = null;
    }
  } else if (updates.affected_village !== undefined) {
    nextVillageId = resolveVillageId(null, nextAffectedVillage).villageId;
  }

  let acknowledgedAt = updates.acknowledged_at ?? prev.acknowledged_at;
  if (updates.acknowledged === true && updates.acknowledged_at === undefined) {
    acknowledgedAt = now;
  } else if (updates.acknowledged === false && updates.acknowledged_at === undefined) {
    acknowledgedAt = null;
  }

  const updated: AlertRecord = {
    ...prev,
    ...updates,
    affected_village: nextAffectedVillage,
    village_id: nextVillageId,
    id: prev.id,
    acknowledged_at: acknowledgedAt,
    updated_at: now,
  };
  store.alerts[idx] = updated;
  res.json(updated);
});

api.delete('/alerts/:id', (req: Request, res: Response) => {
  const idx = store.alerts.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Alert not found.' });
  store.alerts.splice(idx, 1);
  res.json({ status: 'deleted', id: req.params.id });
});

// Patrols CRUD
api.get('/patrols', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const filtered = store.patrols
    .filter((item) =>
      matchesDivision(q.division || q.district, [
        item.district,
        item.sector,
        item.target_area,
        item.team_name,
      ])
    )
    .filter((item) => (!q.status || q.status === 'All' ? true : item.status === q.status))
    .filter((item) => (!q.priority || q.priority === 'All' ? true : item.priority === q.priority))
    .filter((item) =>
      q.is_demo !== undefined ? item.is_demo === (q.is_demo === 'true') : true
    )
    .filter((item) => {
      if (!q.search || !q.search.trim()) return true;
      const term = q.search.trim().toLowerCase();
      return [
        item.patrol_code,
        item.team_name,
        item.lead_officer,
        item.sector,
        item.target_area,
      ].some((f) => f.toLowerCase().includes(term));
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  res.json(paginate(filtered, q.page, q.page_size));
});

api.get('/patrols/:id', (req: Request, res: Response) => {
  const record = store.patrols.find((p) => p.id === req.params.id);
  if (!record) return res.status(404).json({ detail: 'Patrol not found.' });
  res.json(record);
});

api.post('/patrols', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const errors: string[] = [];
  for (const [key, label] of [
    ['team_name', 'team_name'],
    ['lead_officer', 'lead_officer'],
    ['target_area', 'target_area'],
    ['sector', 'sector'],
    ['district', 'district'],
    ['priority', 'priority'],
    ['status', 'status'],
    ['scheduled_window', 'scheduled_window'],
    ['risk_rationale', 'risk_rationale'],
    ['approved_by', 'approved_by'],
  ] as const) {
    const err = requireNonEmptyString(body[key], label);
    if (err) errors.push(err);
  }
  const coords = validateCoordPair(body.latitude, body.longitude);
  if (coords.error) errors.push(coords.error);
  const personnel = Number(body.active_personnel);
  if (!Number.isFinite(personnel) || personnel < 1 || personnel > 200) {
    errors.push('active_personnel must be between 1 and 200.');
  }
  const fk = resolveVillageId(body.village_id, body.target_area, body.sector);
  if (fk.error) errors.push(fk.error);
  if (errors.length > 0) {
    return res.status(422).json({ detail: errors.join(' ') });
  }

  const now = new Date().toISOString();
  const code =
    typeof body.patrol_code === 'string' && body.patrol_code.trim()
      ? body.patrol_code.trim()
      : `PTR-2026-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const created: PatrolRecord = {
    id: crypto.randomUUID(),
    patrol_code: code,
    team_name: String(body.team_name).trim(),
    lead_officer: String(body.lead_officer).trim(),
    target_area: String(body.target_area).trim(),
    sector: String(body.sector).trim(),
    district: String(body.district).trim(),
    village_id: fk.villageId,
    priority: String(body.priority).trim(),
    status: String(body.status).trim(),
    scheduled_window: String(body.scheduled_window).trim(),
    active_personnel: Math.round(personnel),
    equipment: Array.isArray(body.equipment) ? body.equipment : [],
    risk_rationale: String(body.risk_rationale).trim(),
    approved_by: String(body.approved_by).trim(),
    latitude: coords.lat,
    longitude: coords.lng,
    is_demo: false,
    created_at: now,
    updated_at: now,
  };
  store.patrols.unshift(created);
  res.status(201).json(created);
});

api.put('/patrols/:id', (req: Request, res: Response) => {
  const idx = store.patrols.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Patrol not found.' });
  const prev = store.patrols[idx];
  const updates = req.body ?? {};
  const errors: string[] = [];

  for (const key of [
    'team_name',
    'lead_officer',
    'target_area',
    'sector',
    'district',
    'priority',
    'status',
    'scheduled_window',
    'risk_rationale',
    'approved_by',
  ] as const) {
    if (updates[key] !== undefined) {
      const err = requireNonEmptyString(updates[key], key);
      if (err) errors.push(err);
    }
  }

  let nextLat = prev.latitude;
  let nextLng = prev.longitude;
  if (updates.latitude !== undefined || updates.longitude !== undefined) {
    const coords = validateCoordPair(
      updates.latitude !== undefined ? updates.latitude : prev.latitude,
      updates.longitude !== undefined ? updates.longitude : prev.longitude
    );
    if (coords.error) errors.push(coords.error);
    nextLat = coords.lat;
    nextLng = coords.lng;
  }

  let nextPersonnel = prev.active_personnel;
  if (updates.active_personnel !== undefined) {
    const pVal = Number(updates.active_personnel);
    if (!Number.isFinite(pVal) || pVal < 1 || pVal > 200) {
      errors.push('active_personnel must be between 1 and 200.');
    } else {
      nextPersonnel = Math.round(pVal);
    }
  }

  const nextTargetArea =
    updates.target_area !== undefined ? String(updates.target_area).trim() : prev.target_area;
  const nextSector = updates.sector !== undefined ? String(updates.sector).trim() : prev.sector;

  let nextVillageId = prev.village_id;
  if ('village_id' in updates) {
    if (updates.village_id !== null && updates.village_id !== undefined) {
      const fk = resolveVillageId(updates.village_id);
      if (fk.error) errors.push(fk.error);
      nextVillageId = fk.villageId;
    } else if (updates.target_area !== undefined || updates.sector !== undefined) {
      nextVillageId = resolveVillageId(null, nextTargetArea, nextSector).villageId;
    } else {
      nextVillageId = null;
    }
  } else if (updates.target_area !== undefined || updates.sector !== undefined) {
    nextVillageId = resolveVillageId(null, nextTargetArea, nextSector).villageId;
  }

  if (errors.length > 0) {
    return res.status(422).json({ detail: errors.join(' ') });
  }

  const updated: PatrolRecord = {
    ...prev,
    team_name: updates.team_name !== undefined ? String(updates.team_name).trim() : prev.team_name,
    lead_officer:
      updates.lead_officer !== undefined ? String(updates.lead_officer).trim() : prev.lead_officer,
    target_area: nextTargetArea,
    sector: nextSector,
    district: updates.district !== undefined ? String(updates.district).trim() : prev.district,
    village_id: nextVillageId,
    priority: updates.priority !== undefined ? String(updates.priority).trim() : prev.priority,
    status: updates.status !== undefined ? String(updates.status).trim() : prev.status,
    scheduled_window:
      updates.scheduled_window !== undefined
        ? String(updates.scheduled_window).trim()
        : prev.scheduled_window,
    active_personnel: nextPersonnel,
    equipment: Array.isArray(updates.equipment)
      ? updates.equipment.map((e: unknown) => String(e).trim()).filter(Boolean)
      : prev.equipment,
    risk_rationale:
      updates.risk_rationale !== undefined
        ? String(updates.risk_rationale).trim()
        : prev.risk_rationale,
    approved_by:
      updates.approved_by !== undefined ? String(updates.approved_by).trim() : prev.approved_by,
    latitude: nextLat,
    longitude: nextLng,
    id: prev.id,
    updated_at: new Date().toISOString(),
  };
  store.patrols[idx] = updated;
  res.json(updated);
});

api.delete('/patrols/:id', (req: Request, res: Response) => {
  const idx = store.patrols.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Patrol not found.' });
  store.patrols.splice(idx, 1);
  res.json({ status: 'deleted', id: req.params.id });
});

// Villages CRUD
api.get('/villages', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const filtered = store.villages
    .filter((item) =>
      matchesDivision(q.division || q.district, [
        item.district,
        item.forest_range,
        item.name,
        item.assigned_rrt,
      ])
    )
    .filter((item) =>
      !q.forest_range || q.forest_range === 'All'
        ? true
        : item.forest_range.toLowerCase().includes(q.forest_range.trim().toLowerCase())
    )
    .filter((item) =>
      !q.risk_level || q.risk_level === 'All' ? true : item.risk_level === q.risk_level
    )
    .filter((item) =>
      q.is_demo !== undefined ? item.is_demo === (q.is_demo === 'true') : true
    )
    .filter((item) => {
      if (!q.search || !q.search.trim()) return true;
      const term = q.search.trim().toLowerCase();
      return [item.name, item.district, item.forest_range, item.assigned_rrt].some((f) =>
        f.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => b.risk_score - a.risk_score || a.name.localeCompare(b.name));

  res.json(paginate(filtered, q.page, q.page_size));
});

api.get('/villages/:id', (req: Request, res: Response) => {
  const record = store.villages.find((v) => v.id === req.params.id);
  if (!record) return res.status(404).json({ detail: 'Village not found.' });
  res.json(record);
});

api.post('/villages', (req: Request, res: Response) => {
  const body = req.body ?? {};
  const now = new Date().toISOString();
  const created: VillageRecord = {
    id: crypto.randomUUID(),
    name: String(body.name || 'New Fringe Village').trim(),
    district: String(body.district || 'Bandipur Division').trim(),
    forest_range: String(body.forest_range || 'Hediyala Range').trim(),
    population: Number(body.population) || 0,
    households: Number(body.households) || 0,
    forest_distance_km: Number(body.forest_distance_km) || 1.0,
    latitude: Number(body.latitude) || 11.66,
    longitude: Number(body.longitude) || 76.62,
    risk_level: body.risk_level || 'Moderate',
    risk_score: Number(body.risk_score) || 50,
    active_solar_fence: Boolean(body.active_solar_fence),
    fence_status: body.fence_status || 'Operational',
    assigned_rrt: String(body.assigned_rrt || 'QRT Unit').trim(),
    emergency_contact: String(body.emergency_contact || '').trim(),
    recent_incidents_30d: Number(body.recent_incidents_30d) || 0,
    is_demo: false,
    created_at: now,
    updated_at: now,
  };
  store.villages.push(created);
  res.status(201).json(created);
});

api.put('/villages/:id', (req: Request, res: Response) => {
  const idx = store.villages.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Village not found.' });
  const updated: VillageRecord = {
    ...store.villages[idx],
    ...req.body,
    id: store.villages[idx].id,
    updated_at: new Date().toISOString(),
  };
  store.villages[idx] = updated;
  res.json(updated);
});

api.delete('/villages/:id', (req: Request, res: Response) => {
  const idx = store.villages.findIndex((v) => v.id === req.params.id);
  if (idx === -1) return res.status(404).json({ detail: 'Village not found.' });
  store.villages.splice(idx, 1);
  res.json({ status: 'deleted', id: req.params.id });
});

// GIS Spatial endpoints
api.get('/gis/features', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const activeDivision = q.division || q.district;
  const selectedLayers = q.layer
    ? new Set(
        q.layer
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
    : new Set(['incidents', 'sightings', 'villages', 'risk_zones', 'alerts']);

  const features: unknown[] = [];

  if (selectedLayers.has('risk_zones')) {
    for (const rz of store.riskZones) {
      if (!matchesDivision(activeDivision, [rz.district, rz.forest_range, rz.name])) continue;
      if (q.species && q.species !== 'All' && rz.dominant_species !== q.species) continue;
      if (q.severity && q.severity !== 'All' && rz.risk_level !== q.severity) continue;
      features.push(riskZoneToGeoJSON(rz));
    }
  }

  if (selectedLayers.has('villages')) {
    for (const v of store.villages) {
      if (
        !matchesDivision(activeDivision, [v.district, v.forest_range, v.name, v.assigned_rrt])
      ) {
        continue;
      }
      if (q.severity && q.severity !== 'All' && v.risk_level !== q.severity) continue;
      features.push(villageToGeoJSON(v));
    }
  }

  if (selectedLayers.has('incidents')) {
    for (const inc of store.incidents) {
      if (!matchesDivision(activeDivision, [inc.district, inc.forest_range, inc.village])) continue;
      if (q.species && q.species !== 'All' && inc.species !== q.species) continue;
      if (q.severity && q.severity !== 'All' && inc.severity !== q.severity) continue;
      if (!matchesDateWindow(inc.date_time, q.date_from, q.date_to, q.date_range)) continue;
      features.push(incidentToGeoJSON(inc));
    }
  }

  if (selectedLayers.has('sightings')) {
    for (const s of store.sightings) {
      if (!matchesDivision(activeDivision, [s.district, s.forest_range, s.location_name])) {
        continue;
      }
      if (q.species && q.species !== 'All' && s.species !== q.species) continue;
      if (!matchesDateWindow(s.timestamp, q.date_from, q.date_to, q.date_range)) continue;
      features.push(sightingToGeoJSON(s));
    }
  }

  if (selectedLayers.has('alerts')) {
    for (const a of store.alerts) {
      if (
        !matchesDivision(activeDivision, [a.district, a.affected_village, a.title, a.message])
      ) {
        continue;
      }
      if (q.species && q.species !== 'All' && a.species !== q.species) continue;
      if (q.severity && q.severity !== 'All' && a.severity !== q.severity) continue;
      if (!matchesDateWindow(a.triggered_at, q.date_from, q.date_to, q.date_range)) continue;
      features.push(alertToGeoJSON(a));
    }
  }

  res.json({
    type: 'FeatureCollection',
    crs: 'EPSG:4326',
    count: features.length,
    features,
  });
});

api.get('/gis/risk-zones', (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const features = store.riskZones
    .filter((rz) => matchesDivision(q.division || q.district, [rz.district, rz.forest_range, rz.name]))
    .filter((rz) => (!q.species || q.species === 'All' ? true : rz.dominant_species === q.species))
    .filter((rz) => (!q.severity || q.severity === 'All' ? true : rz.risk_level === q.severity))
    .sort((a, b) => b.risk_score - a.risk_score)
    .map(riskZoneToGeoJSON);

  res.json({
    type: 'FeatureCollection',
    crs: 'EPSG:4326',
    count: features.length,
    features,
  });
});

api.get('/gis/nearby-incidents', (req: Request, res: Response) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(422).json({ detail: 'lat and lng query parameters are required.' });
  }
  const radiusKm = Math.min(500, Math.max(0.1, Number(req.query.radius_km) || 5.0));
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));

  const features = store.incidents
    .map((inc) => ({ inc, distKm: haversineKm(lat, lng, inc.latitude, inc.longitude) }))
    .filter((pair) => pair.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, limit)
    .map((pair) => incidentToGeoJSON(pair.inc, pair.distKm));

  res.json({
    type: 'FeatureCollection',
    crs: 'EPSG:4326',
    count: features.length,
    features,
  });
});

app.use(API_PREFIX, api);

function isTcpPortOpen(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

async function startFastApiSidecar(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const explicitSidecarOptIn = process.env.WICPS_ENABLE_FASTAPI_SIDECAR === 'true';
  if (process.env.WICPS_DISABLE_FASTAPI_SIDECAR === 'true' || (isProd && !explicitSidecarOptIn)) {
    return;
  }
  const backendDir = path.resolve(__dirname, 'backend');
  const venvBinDir = path.join(backendDir, '.venv', 'bin');
  const venvPython = path.join(venvBinDir, 'python');
  const uvicornBin = path.join(venvBinDir, 'uvicorn');
  const alembicBin = path.join(venvBinDir, 'alembic');
  const useVenvUvicorn = fs.existsSync(uvicornBin);
  const useVenvPython = fs.existsSync(venvPython);
  if (!useVenvUvicorn && !useVenvPython) {
    console.warn('FastAPI sidecar skipped: backend/.venv/bin/uvicorn not found.');
    return;
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    FASTAPI_SIDECAR_URL,
  };
  if (!childEnv.AUTH_JWT_SECRET) {
    childEnv.AUTH_JWT_SECRET = crypto.randomBytes(32).toString('hex');
  }

  if (process.env.FASTAPI_SIDECAR_DATABASE_URL) {
    childEnv.DATABASE_URL = process.env.FASTAPI_SIDECAR_DATABASE_URL;
  } else if (
    !childEnv.DATABASE_URL ||
    childEnv.DATABASE_URL.includes('@localhost:5432') ||
    childEnv.DATABASE_URL.includes('@127.0.0.1:5432')
  ) {
    const pgUp = childEnv.DATABASE_URL ? await isTcpPortOpen('127.0.0.1', 5432) : false;
    if (!pgUp) {
      childEnv.DATABASE_URL = 'sqlite:///./wicps_dev_phase1.db';
    }
  }

  if (!childEnv.STORAGE_BACKEND) {
    childEnv.STORAGE_BACKEND = 'filesystem';
  }
  if (!childEnv.LOCAL_STORAGE_DIR) {
    childEnv.LOCAL_STORAGE_DIR = './storage_dev';
  }
  if (
    process.env.FASTAPI_SIDECAR_AUTO_SEED !== 'false' &&
    (!childEnv.AUTO_SEED_DEMO_DATA ||
      childEnv.DATABASE_URL === 'sqlite:///./wicps_dev_phase1.db')
  ) {
    childEnv.AUTO_SEED_DEMO_DATA = 'true';
  }
  if (process.env.FASTAPI_SIDECAR_PRELOAD_MODELS !== 'true') {
    childEnv.SPECIESNET_PRELOAD_ON_STARTUP = 'false';
    childEnv.MEGADESCRIPTOR_PRELOAD_ON_STARTUP = 'false';
  }

  if (fs.existsSync(alembicBin)) {
    try {
      execFileSync(alembicBin, ['-c', 'alembic.ini', 'upgrade', 'head'], {
        cwd: backendDir,
        env: childEnv,
        stdio: 'pipe',
      });
    } catch (err) {
      console.error('FastAPI sidecar Alembic migration failed:', err);
    }
  }

  const spawnCmd = useVenvUvicorn ? uvicornBin : venvPython;
  const spawnArgs = useVenvUvicorn
    ? ['app.main:app', '--host', FASTAPI_SIDECAR_HOST, '--port', String(FASTAPI_SIDECAR_PORT)]
    : ['-m', 'uvicorn', 'app.main:app', '--host', FASTAPI_SIDECAR_HOST, '--port', String(FASTAPI_SIDECAR_PORT)];

  fastApiProcess = spawn(spawnCmd, spawnArgs, {
    cwd: backendDir,
    env: childEnv,
    stdio: 'inherit',
  });

  fastApiProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`FastAPI sidecar exited (code=${code}, signal=${signal})`);
    }
    fastApiProcess = null;
  });

  const stopSidecar = () => {
    if (fastApiProcess && !fastApiProcess.killed) {
      fastApiProcess.kill('SIGTERM');
    }
  };
  process.once('exit', stopSidecar);
  process.once('SIGINT', () => {
    stopSidecar();
    process.exit(0);
  });
  process.once('SIGTERM', () => {
    stopSidecar();
    process.exit(0);
  });

  // Wait briefly for the FastAPI socket to accept connections before Vite/client traffic arrives
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (fastApiProcess === null) break;
    if (await isTcpPortOpen(FASTAPI_SIDECAR_HOST, FASTAPI_SIDECAR_PORT, 300)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function startServer() {
  await startFastApiSidecar();

  if (process.env.NODE_ENV !== 'production') {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ...(disableHmr ? { hmr: false, ws: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `WICPS server listening on http://0.0.0.0:${PORT} (API: ${API_PREFIX}, FastAPI Sidecar: ${FASTAPI_SIDECAR_URL})`
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start WICPS server:', err);
  process.exit(1);
});
