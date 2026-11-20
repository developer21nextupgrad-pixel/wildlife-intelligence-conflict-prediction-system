import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractApiErrorMessage,
  mapAlertFromApi,
  mapAlertToCreatePayload,
  mapAlertToUpdatePayload,
  mapIncidentFromApi,
  mapIncidentToCreatePayload,
  mapIncidentToUpdatePayload,
  mapPatrolFromApi,
  mapPatrolToCreatePayload,
  mapPatrolToUpdatePayload,
  mapRiskZoneFromGeoJson,
  mapSightingFromApi,
  mapSightingToCreatePayload,
  mapSightingToUpdatePayload,
  mapVillageFromApi,
} from './apiMappers';

test('mapIncidentFromApi and mapIncidentToCreatePayload preserve coordinates and isDemo flag', () => {
  const payload = mapIncidentToCreatePayload({
    species: 'Asian Elephant',
    dateTime: '2026-11-10T21:40:00Z',
    latitude: 11.6624,
    longitude: 76.6189,
    village: ' Kadambur Fringe ',
    district: 'Bandipur Division',
    forestRange: 'Hediyala Range',
    incidentType: 'Crop Depredation',
    severity: 'High',
    humanInjury: 'None',
    humanInjuriesCount: 0,
    livestockLossCount: 0,
    cropDamageEstimatedAcres: 2.5,
    description: ' Herd crossed boundary ',
    status: 'Reported',
    reportedBy: 'RFO Suresh Kumar',
  });

  assert.equal(payload.village, 'Kadambur Fringe');
  assert.equal(payload.crop_damage_estimated_acres, 2.5);
  assert.equal(payload.latitude, 11.6624);

  const mapped = mapIncidentFromApi({
    id: 'uuid-1',
    incident_code: 'WICPS-2026-999',
    species: 'Asian Elephant',
    date_time: '2026-11-10T21:40:00Z',
    latitude: 11.6624,
    longitude: 76.6189,
    village: 'Kadambur Fringe',
    district: 'Bandipur Division',
    forest_range: 'Hediyala Range',
    incident_type: 'Crop Depredation',
    severity: 'High',
    human_injury: 'None',
    human_injuries_count: 0,
    livestock_loss_count: 0,
    crop_damage_estimated_acres: 2.5,
    description: 'Herd crossed boundary',
    status: 'Reported',
    reported_by: 'RFO Suresh Kumar',
    is_demo: false,
  });

  assert.equal(mapped.incidentCode, 'WICPS-2026-999');
  assert.equal(mapped.isDemo, false);
});

test('mapSighting, mapAlert, and mapPatrol preserve coordinates tuple order [lat, lng]', () => {
  const sightingPayload = mapSightingToCreatePayload({
    species: 'Bengal Tiger',
    timestamp: '2026-11-11T05:20:00Z',
    latitude: 11.635,
    longitude: 76.578,
    locationName: 'Omkar Salt Lick',
    forestRange: 'Omkar Range',
    herdSize: 1,
    movementDirection: 'North',
    bearingDegrees: 0,
    behavior: 'Resting',
    juvenilesPresent: false,
    observationDetails: 'Resting near bamboo',
    observerName: 'Biologist',
    observerRole: 'Field Biologist',
    verifiedByForestGuard: true,
  });
  assert.equal(sightingPayload.location_name, 'Omkar Salt Lick');

  const sighting = mapSightingFromApi({
    id: 's-1',
    sighting_code: 'SIGHT-2026-001',
    species: 'Bengal Tiger',
    timestamp: '2026-11-11T05:20:00Z',
    latitude: 11.635,
    longitude: 76.578,
    location_name: 'Omkar Salt Lick',
    forest_range: 'Omkar Range',
    herd_size: 1,
    movement_direction: 'North',
    bearing_degrees: 0,
    behavior: 'Resting',
    juveniles_present: false,
    observation_details: 'Resting near bamboo',
    observer_name: 'Biologist',
    observer_role: 'Field Biologist',
    verified_by_forest_guard: true,
    is_demo: true,
  });
  assert.equal(sighting.isDemo, true);

  const alert = mapAlertFromApi({
    id: 'a-1',
    title: 'Elephant Alert',
    message: 'Boundary breach',
    severity: 'Critical',
    species: 'Asian Elephant',
    affected_village: 'Kadambur Fringe',
    district: 'Bandipur Division',
    latitude: 11.662,
    longitude: 76.618,
    alert_time: 'Just now',
    acknowledged: false,
    response_status: 'Pending Dispatch',
    is_demo: false,
  });
  assert.deepEqual(alert.coordinates, [11.662, 76.618]);
  assert.equal(alert.isDemo, false);

  const patrolPayload = mapPatrolToCreatePayload({
    teamName: 'QRT Alpha',
    leadOfficer: 'Capt. Ravindran',
    targetArea: 'Sector 4B',
    sector: 'Hediyala Range',
    priority: 'Critical',
    status: 'Scheduled',
    scheduledWindow: '18:00 - 04:00 IST',
    activePersonnel: 5,
    equipment: ['Thermal Scope'],
    riskRationale: 'Fence breach response',
    approvedBy: 'DFO',
    coordinates: [11.664, 76.62],
  });
  assert.equal(patrolPayload.latitude, 11.664);
  assert.equal(patrolPayload.longitude, 76.62);

  const patrol = mapPatrolFromApi({
    id: 'p-1',
    patrol_code: 'PTR-2026-001',
    team_name: 'QRT Alpha',
    lead_officer: 'Capt. Ravindran',
    target_area: 'Sector 4B',
    sector: 'Hediyala Range',
    priority: 'Critical',
    status: 'Scheduled',
    scheduled_window: '18:00 - 04:00 IST',
    active_personnel: 5,
    equipment: ['Thermal Scope'],
    risk_rationale: 'Fence breach response',
    approved_by: 'DFO',
    latitude: 11.664,
    longitude: 76.62,
    is_demo: false,
  });
  assert.deepEqual(patrol.coordinates, [11.664, 76.62]);
});

test('extractApiErrorMessage formats FastAPI validation arrays and detail strings', () => {
  const msg = extractApiErrorMessage(
    422,
    {
      detail: 'Request validation failed',
      errors: [{ field: 'body.latitude', message: 'Latitude must be between -90 and 90' }],
    },
    'Validation error'
  );
  assert.match(msg, /HTTP 422/);
  assert.match(msg, /body\.latitude/);
});

test('mapAlertToCreatePayload and mapAlertToUpdatePayload map snake_case fields cleanly', () => {
  const createPayload = mapAlertToCreatePayload({
    title: ' CRITICAL: Herd near fence ',
    message: ' 8 elephants sighted 200m from paddy plot ',
    severity: 'Critical',
    species: 'Asian Elephant',
    affectedVillage: ' Kadambur Fringe ',
    district: ' Bandipur Division ',
    latitude: 11.6624,
    longitude: 76.6189,
    triggeredAt: '2026-11-17T14:30:00Z',
    assignedOfficer: ' RFO Suresh Kumar ',
    responseStatus: 'RRT En Route',
  });
  assert.equal(createPayload.title, 'CRITICAL: Herd near fence');
  assert.equal(createPayload.affected_village, 'Kadambur Fringe');
  assert.equal(createPayload.assigned_officer, 'RFO Suresh Kumar');
  assert.equal(createPayload.response_status, 'RRT En Route');
  assert.equal(createPayload.alert_time, '2026-11-17 14:30 UTC');

  const updatePayload = mapAlertToUpdatePayload({
    title: 'Updated Alert Title',
    assignedOfficer: '   ',
    responseStatus: 'Area Cleared',
  });
  assert.equal(updatePayload.title, 'Updated Alert Title');
  assert.equal(updatePayload.assigned_officer, null);
  assert.equal(updatePayload.response_status, 'Area Cleared');
});

test('mapSightingToUpdatePayload normalizes edited fields and preserves or clears photo_url explicitly', () => {
  const updated = mapSightingToUpdatePayload({
    species: 'Asian Elephant',
    timestamp: '2026-11-17T10:15:00Z',
    latitude: 11.6712,
    longitude: 76.6251,
    locationName: '  Sector 5B Checkdam  ',
    district: '  Bandipur Division  ',
    forestRange: '  Hediyala Range  ',
    herdSize: 7,
    movementDirection: 'West',
    bearingDegrees: 270,
    behavior: 'Moving towards village',
    juvenilesPresent: true,
    observationDetails: '  Herd turned west toward solar line  ',
    observerName: '  RFO Suresh Kumar  ',
    observerRole: '  Range Officer  ',
    verifiedByForestGuard: true,
    photoUrl: ' https://example.org/elephant-sighting.jpg ',
  });

  assert.equal(updated.location_name, 'Sector 5B Checkdam');
  assert.equal(updated.district, 'Bandipur Division');
  assert.equal(updated.forest_range, 'Hediyala Range');
  assert.equal(updated.herd_size, 7);
  assert.equal(updated.bearing_degrees, 270);
  assert.equal(updated.juveniles_present, true);
  assert.equal(updated.photo_url, 'https://example.org/elephant-sighting.jpg');

  const clearedPhoto = mapSightingToUpdatePayload({ photoUrl: '   ' });
  assert.equal(clearedPhoto.photo_url, null);

  const untouchedPhoto = mapSightingToUpdatePayload({ herdSize: 3 });
  assert.equal('photo_url' in untouchedPhoto, false);
});

test('mapIncidentToUpdatePayload maps edited incident fields and clears optional nulls explicitly', () => {
  const payload = mapIncidentToUpdatePayload({
    species: 'Bengal Tiger',
    dateTime: '2026-11-18T14:15:00Z',
    latitude: 11.6512,
    longitude: 76.6095,
    village: '  Mangala Settlement  ',
    district: '  Bandipur Division  ',
    forestRange: '  Gundlupet Buffer  ',
    incidentType: 'Livestock Predation',
    severity: 'Critical',
    humanInjury: 'Minor',
    humanInjuriesCount: 1,
    livestockLossCount: 2,
    cropDamageEstimatedAcres: 1.5,
    cropType: '  ',
    description: '  Confirmed tiger attack near cattle shed  ',
    imageUrl: '  ',
    status: 'Patrol Dispatched',
    reportedBy: '  RFO Suresh Kumar  ',
    assignedOfficer: '   ',
    actionTaken: '  Dispatched QRT Alpha  ',
  });

  assert.equal(payload.species, 'Bengal Tiger');
  assert.equal(payload.village, 'Mangala Settlement');
  assert.equal(payload.forest_range, 'Gundlupet Buffer');
  assert.equal(payload.human_injuries_count, 1);
  assert.equal(payload.livestock_loss_count, 2);
  assert.equal(payload.crop_damage_estimated_acres, 1.5);
  assert.equal(payload.crop_type, null);
  assert.equal(payload.image_url, null);
  assert.equal(payload.assigned_officer, null);
  assert.equal(payload.action_taken, 'Dispatched QRT Alpha');
  assert.equal(payload.status, 'Patrol Dispatched');
});

test('mapPatrolToUpdatePayload maps patrol fields and coordinates cleanly', () => {
  const payload = mapPatrolToUpdatePayload({
    teamName: '  QRT Delta  ',
    leadOfficer: '  RFO K. Natarajan  ',
    targetArea: '  Mangala - Gundlupet Buffer  ',
    sector: '  Gundlupet Beat 01  ',
    district: '  Bandipur Division  ',
    priority: 'Critical',
    status: 'In Progress',
    scheduledWindow: '  2026-11-19 | 19:00 - 05:00 IST  ',
    activePersonnel: 7,
    equipment: ['Thermal Monocular', 'GPS Beacon'],
    riskRationale: '  Elevated corridor movement  ',
    approvedBy: '  DFO Bandipur  ',
    coordinates: [11.659, 76.648],
  });

  assert.equal(payload.team_name, 'QRT Delta');
  assert.equal(payload.lead_officer, 'RFO K. Natarajan');
  assert.equal(payload.target_area, 'Mangala - Gundlupet Buffer');
  assert.equal(payload.scheduled_window, '2026-11-19 | 19:00 - 05:00 IST');
  assert.equal(payload.active_personnel, 7);
  assert.deepEqual(payload.equipment, ['Thermal Monocular', 'GPS Beacon']);
  assert.equal(payload.latitude, 11.659);
  assert.equal(payload.longitude, 76.648);
});

test('mapVillageFromApi and mapRiskZoneFromGeoJson convert API DTOs and [lng, lat] rings', () => {
  const village = mapVillageFromApi({
    id: 'vil-1',
    name: 'Kadambur Fringe',
    district: 'Bandipur Division',
    forest_range: 'Hediyala Range',
    population: 1450,
    households: 320,
    forest_distance_km: 0.4,
    latitude: 11.662,
    longitude: 76.618,
    risk_level: 'Critical',
    risk_score: 92,
    active_solar_fence: true,
    fence_status: 'Breached',
    assigned_rrt: 'RRT Hediyala Alpha',
    emergency_contact: '+91-98450-11223',
    recent_incidents_30d: 4,
    is_demo: true,
  });

  assert.equal(village.forestRange, 'Hediyala Range');
  assert.deepEqual(village.coordinates, [11.662, 76.618]);
  assert.equal(village.isDemo, true);

  const riskZone = mapRiskZoneFromGeoJson({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [76.61, 11.66],
          [76.63, 11.66],
          [76.63, 11.67],
          [76.61, 11.66],
        ],
      ],
    },
    properties: {
      id: 'rz-1',
      name: 'Kadambur Corridor',
      district: 'Bandipur Division',
      forest_range: 'Hediyala Range',
      risk_level: 'Critical',
      risk_score: 94,
      dominant_species: 'Asian Elephant',
      center_lat: 11.663,
      center_lng: 76.62,
      active_alert_count: 2,
      primary_risk_factor: 'Solar fence breach',
      is_demo: true,
    },
  });

  assert.equal(riskZone.range, 'Hediyala Range');
  assert.deepEqual(riskZone.centerCoordinates, [11.663, 76.62]);
  assert.deepEqual(riskZone.polygonCoordinates, [
    [11.66, 76.61],
    [11.66, 76.63],
    [11.67, 76.63],
  ]);
  assert.equal(riskZone.isDemo, true);
});

