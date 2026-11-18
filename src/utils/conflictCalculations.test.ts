import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiskScore, filterIncidents, formatCoordinates, generateDemoPrediction } from './conflictCalculations';
import { Incident } from '../types';

test('calculateRiskScore returns higher risk for high incidents and close proximity', () => {
  const highRisk = calculateRiskScore({
    recentIncidents: 4,
    herdSize: 8,
    distanceToForestKm: 0.5,
    cropHarvestSeason: true,
    waterScarcityIndex: 9,
  });

  assert.ok(highRisk.score >= 70, `Score should be >= 70, got ${highRisk.score}`);
  assert.equal(highRisk.level, 'Critical');

  const lowRisk = calculateRiskScore({
    recentIncidents: 0,
    herdSize: 1,
    distanceToForestKm: 5.0,
    cropHarvestSeason: false,
    waterScarcityIndex: 1,
  });

  assert.ok(lowRisk.score < 40, `Score should be < 40, got ${lowRisk.score}`);
  assert.equal(lowRisk.level, 'Low');
});

test('formatCoordinates returns formatted cardinal direction string', () => {
  const formatted = formatCoordinates(11.6854, 76.6291);
  assert.equal(formatted, '11.6854° N, 76.6291° E');
});

test('filterIncidents correctly filters by species and status', () => {
  const dummyIncidents: Incident[] = [
    {
      id: 'inc-1',
      incidentCode: 'WICPS-2026-001',
      species: 'Asian Elephant',
      dateTime: '2026-11-10T19:30:00Z',
      latitude: 11.65,
      longitude: 76.62,
      village: 'Kadambur',
      district: 'Chamarajanagar',
      forestRange: 'Bandipur Buffer',
      incidentType: 'Crop Depredation',
      severity: 'High',
      humanInjury: 'None',
      humanInjuriesCount: 0,
      livestockLossCount: 0,
      cropDamageEstimatedAcres: 3.5,
      description: 'Herd raided paddy fields',
      status: 'Patrol Dispatched',
      reportedBy: 'Village Forest Committee',
    },
    {
      id: 'inc-2',
      incidentCode: 'WICPS-2026-002',
      species: 'Indian Leopard',
      dateTime: '2026-11-09T22:15:00Z',
      latitude: 11.70,
      longitude: 76.65,
      village: 'Mangala',
      district: 'Gundlupet',
      forestRange: 'Gundlupet Range',
      incidentType: 'Livestock Predation',
      severity: 'Critical',
      humanInjury: 'Minor',
      humanInjuriesCount: 1,
      livestockLossCount: 2,
      cropDamageEstimatedAcres: 0,
      description: 'Attacked cattle in shed',
      status: 'Resolved',
      reportedBy: 'Forest Beat Guard',
    },
  ];

  const filteredElephant = filterIncidents(dummyIncidents, { species: 'Asian Elephant' });
  assert.equal(filteredElephant.length, 1);
  assert.equal(filteredElephant[0].species, 'Asian Elephant');

  const filteredResolved = filterIncidents(dummyIncidents, { status: 'Resolved' });
  assert.equal(filteredResolved.length, 1);
  assert.equal(filteredResolved[0].incidentCode, 'WICPS-2026-002');

  const searchResult = filterIncidents(dummyIncidents, { searchQuery: 'Kadambur' });
  assert.equal(searchResult.length, 1);
  assert.equal(searchResult[0].village, 'Kadambur');
});

test('generateDemoPrediction produces simulated result with demo disclaimer flag', () => {
  const prediction = generateDemoPrediction('Asian Elephant', 'Bandipur Reserve Division', 'Next 24 Hours');
  assert.equal(prediction.species, 'Asian Elephant');
  assert.equal(prediction.isDemoEstimate, true);
  assert.ok(prediction.probabilityScore > 0 && prediction.probabilityScore <= 100);
  assert.ok(prediction.priorityVillages.length > 0);
  assert.ok(prediction.recommendedPatrolPriorities.length > 0);
  assert.ok(prediction.contributingFactors.length > 0);
});

test('generateDemoPrediction reflects cropMaturityBoost and streamScarcityBoost toggles', () => {
  const withBoth = generateDemoPrediction('Asian Elephant', 'Hediyala Range', 'Next 7 Days', {
    cropMaturityBoost: true,
    streamScarcityBoost: true,
  });
  const withoutCrop = generateDemoPrediction('Asian Elephant', 'Hediyala Range', 'Next 7 Days', {
    cropMaturityBoost: false,
    streamScarcityBoost: true,
  });
  const withoutBoth = generateDemoPrediction('Asian Elephant', 'Hediyala Range', 'Next 7 Days', {
    cropMaturityBoost: false,
    streamScarcityBoost: false,
  });

  assert.equal(withBoth.isDemoEstimate, true);
  assert.equal(withoutBoth.isDemoEstimate, true);
  assert.ok(
    withBoth.probabilityScore > withoutCrop.probabilityScore,
    `Expected withBoth (${withBoth.probabilityScore}) > withoutCrop (${withoutCrop.probabilityScore})`
  );
  assert.ok(
    withoutCrop.probabilityScore > withoutBoth.probabilityScore,
    `Expected withoutCrop (${withoutCrop.probabilityScore}) > withoutBoth (${withoutBoth.probabilityScore})`
  );

  const cropWith = withBoth.contributingFactors.find((f) => f.factor.includes('Crop Ripening'));
  const cropWithout = withoutBoth.contributingFactors.find((f) => f.factor.includes('Crop Ripening'));
  const waterWith = withBoth.contributingFactors.find((f) => f.factor.includes('Waterhole'));
  const waterWithout = withoutBoth.contributingFactors.find((f) => f.factor.includes('Waterhole'));

  assert.ok(cropWith && cropWithout && cropWith.score > cropWithout.score);
  assert.ok(waterWith && waterWithout && waterWith.score > waterWithout.score);
});

