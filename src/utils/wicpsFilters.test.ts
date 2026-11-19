import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DIRECTION_TO_BEARING,
  escapeHtml,
  filterWicpsDatasets,
  getBearingForDirection,
  matchesDateWindow,
  matchesDivisionOrRange,
  validateAlertInput,
  validateCoordinates,
  validateIncidentInput,
  validatePatrolInput,
  validateSightingInput,
  WicpsDatasetBundle,
} from './wicpsFilters';
import {
  INITIAL_ALERTS,
  INITIAL_INCIDENTS,
  INITIAL_PATROLS,
  INITIAL_RISK_ZONES,
  INITIAL_SIGHTINGS,
  INITIAL_TELEMETRY,
  INITIAL_VILLAGES,
} from '../services/mockData';
import { AiRiskPredictionView } from '../components/AiRiskPredictionView';
import { IncidentManagementView } from '../components/IncidentManagementView';
import { AnimalSightingsView } from '../components/AnimalSightingsView';
import { AlertsView } from '../components/AlertsView';
import { PatrolOperationsView } from '../components/PatrolOperationsView';
import { AnalyticsView } from '../components/AnalyticsView';

const BASE_BUNDLE: WicpsDatasetBundle = {
  incidents: INITIAL_INCIDENTS,
  sightings: INITIAL_SIGHTINGS,
  villages: INITIAL_VILLAGES,
  alerts: INITIAL_ALERTS,
  riskZones: INITIAL_RISK_ZONES,
  telemetry: INITIAL_TELEMETRY,
  patrols: INITIAL_PATROLS,
};

test('getBearingForDirection maps all 9 directions to accurate compass degrees', () => {
  const expected: Record<keyof typeof DIRECTION_TO_BEARING, number> = {
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

  for (const [direction, bearing] of Object.entries(expected)) {
    assert.equal(
      getBearingForDirection(direction as keyof typeof DIRECTION_TO_BEARING),
      bearing,
      `Expected ${direction} -> ${bearing}°`
    );
  }
});

test('escapeHtml neutralizes XSS tags and HTML quotes safely', () => {
  const malicious = '<script>alert("xss")</script> & \'single\'';
  const escaped = escapeHtml(malicious);
  assert.equal(
    escaped,
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;single&#39;'
  );
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('matchesDivisionOrRange normalizes range labels including Beat suffixes and Bandipur All', () => {
  assert.equal(matchesDivisionOrRange('Bandipur Division', ['Omkar Range']), true);
  assert.equal(
    matchesDivisionOrRange('Hediyala Range', ['Hediyala Range (Beat 4)', 'Kadambur Fringe']),
    true
  );
  assert.equal(
    matchesDivisionOrRange('GS Betta Range', ['GS Betta Range', 'Gopalaswamy Base']),
    true
  );
  assert.equal(
    matchesDivisionOrRange('Omkar Range', ['Hediyala Range (Beat 4)', 'Kadambur Fringe']),
    false
  );
});

test('matchesDateWindow and filterWicpsDatasets filter across 24h, 7d, 30d and range windows', () => {
  // Reference timestamp matching Nov 16, 2026 12:00 UTC
  const refNowMs = Date.parse('2026-11-16T12:00:00Z');

  // 24h window: sample incidents are Nov 6-10 -> empty sample set
  const liveFiltered = filterWicpsDatasets(BASE_BUNDLE, 'Bandipur Division', 'Live (Last 24 Hours)', refNowMs);
  assert.equal(liveFiltered.incidents.length, 0);
  assert.equal(liveFiltered.sightings.length, 0);

  // 7-day window (Nov 9 12:00Z to Nov 16 12:00Z): Nov 9 06:30Z is outside 7d, Nov 10 incidents (2) pass; Nov 9 18:40Z sighting + Nov 10-11 sightings (5) pass
  const sevenDayFiltered = filterWicpsDatasets(BASE_BUNDLE, 'Bandipur Division', 'Last 7 Days', refNowMs);
  assert.equal(sevenDayFiltered.incidents.length, 2);
  assert.equal(sevenDayFiltered.sightings.length, 5);

  // 30-day window: all 7 incidents and all 5 sightings pass
  const thirtyDayFiltered = filterWicpsDatasets(BASE_BUNDLE, 'Bandipur Division', 'Last 30 Days', refNowMs);
  assert.equal(thirtyDayFiltered.incidents.length, INITIAL_INCIDENTS.length);
  assert.equal(thirtyDayFiltered.sightings.length, INITIAL_SIGHTINGS.length);

  // Range narrowing: Hediyala Range in Last 30 Days matches inc-101 (Hediyala Range (Beat 4)) & inc-105 (Hediyala Range)
  const hediyala30d = filterWicpsDatasets(BASE_BUNDLE, 'Hediyala Range', 'Last 30 Days', refNowMs);
  assert.equal(hediyala30d.incidents.length, 2);
  assert.ok(hediyala30d.riskZones.every((rz) => rz.range === 'Hediyala Range'));
  assert.ok(hediyala30d.telemetry.some((t) => t.animalId === 'EL-04'));

  // Newly added incident at refNowMs appears immediately in Live (Last 24 Hours)
  assert.equal(matchesDateWindow('2026-11-16T12:02:00Z', 'Live (Last 24 Hours)', refNowMs), true);
});

test('validateCoordinates, validateIncidentInput, and validateSightingInput enforce bounds and required fields', () => {
  assert.equal(validateCoordinates(11.66, 76.62).valid, true);
  assert.equal(validateCoordinates(95, 76.62).valid, false);
  assert.equal(validateCoordinates(11.66, -181).valid, false);
  assert.equal(validateCoordinates(Number.NaN, 76.62).valid, false);

  const badIncident = validateIncidentInput({
    village: '   ',
    description: '',
    latitude: 95,
    longitude: 200,
    cropDamageEstimatedAcres: -2,
  });
  assert.ok(badIncident.village);
  assert.ok(badIncident.description);
  assert.ok(badIncident.latitude);
  assert.ok(badIncident.longitude);
  assert.ok(badIncident.cropDamageEstimatedAcres);

  const okIncident = validateIncidentInput({
    village: 'Kadambur',
    description: 'Fence breach verified',
    latitude: 11.6624,
    longitude: 76.6189,
    cropDamageEstimatedAcres: 0,
  });
  assert.deepEqual(okIncident, {});

  const badSighting = validateSightingInput({
    locationName: '',
    observationDetails: '',
    herdSize: 0,
    latitude: -91,
    longitude: 181,
    forestRange: '',
    observerName: '',
    observerRole: '',
  });
  assert.ok(badSighting.locationName);
  assert.ok(badSighting.observationDetails);
  assert.ok(badSighting.herdSize);
  assert.ok(badSighting.latitude);
  assert.ok(badSighting.longitude);
  assert.ok(badSighting.forestRange);
  assert.ok(badSighting.observerName);
  assert.ok(badSighting.observerRole);

  const okSighting = validateSightingInput({
    locationName: 'Sector 4B Checkdam',
    observationDetails: 'Herd crossing slowly',
    herdSize: 4,
    latitude: 11.671,
    longitude: 76.615,
    forestRange: 'Maddur Range',
    district: 'Bandipur Division',
    observerName: 'Beat Guard Ramesh',
    observerRole: 'Forest Guard',
    photoUrl: 'https://example.org/herd.jpg',
  });
  assert.deepEqual(okSighting, {});

  const badSightingMedia = validateSightingInput({
    locationName: 'Sector 4B Checkdam',
    observationDetails: 'Herd crossing slowly',
    herdSize: 600,
    latitude: 11.671,
    longitude: 76.615,
    forestRange: 'Maddur Range',
    district: '  ',
    observerName: 'Beat Guard Ramesh',
    observerRole: 'Forest Guard',
    photoUrl: 'ftp://invalid-scheme.example/img.jpg',
  });
  assert.ok(badSightingMedia.herdSize);
  assert.ok(badSightingMedia.district);
  assert.ok(badSightingMedia.photoUrl);

  const tooLongPhoto = validateSightingInput({
    locationName: 'Sector 4B Checkdam',
    observationDetails: 'Herd crossing slowly',
    herdSize: 2,
    latitude: 11.671,
    longitude: 76.615,
    forestRange: 'Maddur Range',
    observerName: 'Beat Guard Ramesh',
    observerRole: 'Forest Guard',
    photoUrl: `https://example.org/${'a'.repeat(500)}.jpg`,
  });
  assert.ok(tooLongPhoto.photoUrl);

  const badAlert = validateAlertInput({
    title: '  ',
    message: '',
    affectedVillage: '',
    district: ' ',
    latitude: 95,
    longitude: -181,
  });
  assert.ok(badAlert.title);
  assert.ok(badAlert.message);
  assert.ok(badAlert.affectedVillage);
  assert.ok(badAlert.district);
  assert.ok(badAlert.latitude);
  assert.ok(badAlert.longitude);

  const okAlert = validateAlertInput({
    title: 'Tusker sighting near solar fence',
    message: 'Move patrol unit to Kadambur sector.',
    severity: 'High',
    species: 'Asian Elephant',
    responseStatus: 'Pending Dispatch',
    affectedVillage: 'Kadambur Fringe',
    district: 'Bandipur Division',
    latitude: 11.6624,
    longitude: 76.6189,
  });
  assert.deepEqual(okAlert, {});

  const badPatrol = validatePatrolInput({
    teamName: '',
    leadOfficer: '',
    targetArea: '',
    sector: '',
    district: '',
    priority: '',
    status: '',
    scheduledWindow: '',
    activePersonnel: 0,
    riskRationale: '',
    approvedBy: '',
    latitude: Number.NaN,
    longitude: 200,
  });
  assert.ok(badPatrol.teamName);
  assert.ok(badPatrol.leadOfficer);
  assert.ok(badPatrol.targetArea);
  assert.ok(badPatrol.sector);
  assert.ok(badPatrol.district);
  assert.ok(badPatrol.priority);
  assert.ok(badPatrol.status);
  assert.ok(badPatrol.scheduledWindow);
  assert.ok(badPatrol.activePersonnel);
  assert.ok(badPatrol.riskRationale);
  assert.ok(badPatrol.approvedBy);
  assert.ok(badPatrol.latitude);
  assert.ok(badPatrol.longitude);

  const okPatrol = validatePatrolInput({
    teamName: 'QRT Gamma',
    leadOfficer: 'RFO A. Verma',
    targetArea: 'Kadambur Perimeter',
    sector: 'Sector 4B',
    district: 'Bandipur Division',
    priority: 'High',
    status: 'Scheduled',
    scheduledWindow: '20:00 - 04:00 IST',
    activePersonnel: 5,
    riskRationale: 'Preventive night corridor monitoring.',
    approvedBy: 'Duty Officer',
    latitude: 11.6624,
    longitude: 76.6189,
  });
  assert.deepEqual(okPatrol, {});
});

test('Core React views render cleanly via SSR with honest DEMO disclaimers and empty states', () => {
  const aiHtml = renderToStaticMarkup(React.createElement(AiRiskPredictionView));
  assert.match(aiHtml, /DEMO/i);
  assert.match(aiHtml, /Run Conflict Analysis \(Demo\)/);

  const incEmptyHtml = renderToStaticMarkup(
    React.createElement(IncidentManagementView, {
      incidents: [],
      totalUnfilteredCount: INITIAL_INCIDENTS.length,
      onAddIncident: async () => {},
      onUpdateStatus: async () => {},
      globalSearchQuery: 'Kadambur',
      selectedDistrict: 'Hediyala Range',
      dateRange: 'Live (Last 24 Hours)',
      onResetGlobalFilters: () => {},
      isModalOpen: false,
      setIsModalOpen: () => {},
    })
  );
  assert.match(incEmptyHtml, /Kadambur/);
  assert.match(incEmptyHtml, /Reset Global Filter/);

  const sightEmptyHtml = renderToStaticMarkup(
    React.createElement(AnimalSightingsView, {
      sightings: [],
      totalUnfilteredCount: INITIAL_SIGHTINGS.length,
      onAddSighting: async () => {},
      onUpdateSighting: async () => {},
      selectedDistrict: 'Bandipur Division',
      dateRange: 'Live (Last 24 Hours)',
      onResetGlobalFilters: () => {},
    })
  );
  assert.match(sightEmptyHtml, /No sightings match the active filters/);

  const sightCardsHtml = renderToStaticMarkup(
    React.createElement(AnimalSightingsView, {
      sightings: INITIAL_SIGHTINGS.slice(0, 1).map((s) => ({
        ...s,
        photoUrl: 'https://example.org/sighting-preview.jpg',
      })),
      onAddSighting: async () => {},
      onUpdateSighting: async () => {},
      onDeleteSighting: async () => {},
    })
  );
  assert.match(sightCardsHtml, /View Details/);
  assert.match(sightCardsHtml, /Edit/);
  assert.match(sightCardsHtml, /Delete/);
  assert.match(sightCardsHtml, /sighting-preview\.jpg/);

  const alertsHtml = renderToStaticMarkup(
    React.createElement(AlertsView, {
      alerts: INITIAL_ALERTS.map((alert) => ({ ...alert, isDemo: true })),
      onCreateAlert: async () => {},
      onUpdateAlert: async () => {},
      onDeleteAlert: async () => {},
      onAcknowledge: async () => {},
      onUpdateResponseStatus: async () => {},
    })
  );
  assert.match(alertsHtml, /DEMO SEED/);
  assert.match(alertsHtml, /PostgreSQL \+ PostGIS Alert Desk/);
  assert.match(alertsHtml, /Create Alert/);

  const patrolsHtml = renderToStaticMarkup(
    React.createElement(PatrolOperationsView, {
      patrols: INITIAL_PATROLS,
      onCreatePatrol: async () => {},
      onUpdateStatus: async () => {},
      onNavigateToMap: () => {},
    })
  );
  assert.match(patrolsHtml, /View Sectors on GIS Map/);

  const analyticsHtml = renderToStaticMarkup(
    React.createElement(AnalyticsView, {
      incidents: INITIAL_INCIDENTS,
      villages: INITIAL_VILLAGES,
      selectedDistrict: 'Bandipur Division',
      dateRange: 'Last 30 Days',
    })
  );
  assert.match(analyticsHtml, /Diurnal|Monthly Conflict Trend|Human-Wildlife Conflict Analytics/);
});
