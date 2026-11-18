import { SpeciesType, IncidentSeverity, Incident, PredictionResult } from '../types';

/**
 * Calculates risk level based on incident count, herd size, proximity to forest and seasonal crop factors
 */
export function calculateRiskScore(params: {
  recentIncidents: number;
  herdSize?: number;
  distanceToForestKm: number;
  cropHarvestSeason: boolean;
  waterScarcityIndex: number; // 0 - 10
}): { score: number; level: IncidentSeverity } {
  const { recentIncidents, herdSize = 1, distanceToForestKm, cropHarvestSeason, waterScarcityIndex } = params;

  // Baseline proximity calculation: closer to reserve = higher conflict risk
  let proximityScore = Math.max(0, 100 - (distanceToForestKm * 18));
  
  // Incident recurrence weight
  let incidentWeight = Math.min(recentIncidents * 12, 40);

  // Herd size multiplier (larger herds cause more widespread crop and human conflict)
  let herdWeight = Math.min(herdSize * 4, 25);

  // Seasonal crop depredation multiplier
  let cropWeight = cropHarvestSeason ? 20 : 5;

  // Water scarcity during dry spells drives animals out of reserve core into fringe ponds
  let waterWeight = (waterScarcityIndex / 10) * 15;

  let totalScore = Math.min(100, Math.round((proximityScore * 0.3) + incidentWeight + herdWeight + cropWeight + waterWeight));

  let level: IncidentSeverity = 'Low';
  if (totalScore >= 75) {
    level = 'Critical';
  } else if (totalScore >= 55) {
    level = 'High';
  } else if (totalScore >= 35) {
    level = 'Moderate';
  }

  return { score: totalScore, level };
}

/**
 * Filter incidents by species, district, severity/risk, status and keyword
 */
export function filterIncidents(
  incidents: Incident[],
  filters: {
    species?: string;
    district?: string;
    severity?: string;
    status?: string;
    searchQuery?: string;
  }
): Incident[] {
  return incidents.filter((incident) => {
    if (filters.species && filters.species !== 'All' && incident.species !== filters.species) {
      return false;
    }
    if (filters.district && filters.district !== 'All' && incident.district !== filters.district) {
      return false;
    }
    if (filters.severity && filters.severity !== 'All' && incident.severity !== filters.severity) {
      return false;
    }
    if (filters.status && filters.status !== 'All' && incident.status !== filters.status) {
      return false;
    }
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const matchText = `${incident.incidentCode} ${incident.village} ${incident.forestRange} ${incident.description} ${incident.incidentType}`.toLowerCase();
      if (!matchText.includes(q)) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Format coordinates nicely into DMS or clean latitude/longitude string
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
}

export interface DemoPredictionOptions {
  cropMaturityBoost?: boolean;
  streamScarcityBoost?: boolean;
}

/**
 * Generate simulated DEMO risk predictions for a selected species, area and forecast window
 */
export function generateDemoPrediction(
  species: SpeciesType,
  district: string,
  forecastWindow: 'Next 24 Hours' | 'Next 3 Days' | 'Next 7 Days' | 'Next 14 Days',
  options: DemoPredictionOptions = {}
): PredictionResult {
  const { cropMaturityBoost = true, streamScarcityBoost = true } = options;

  // Deterministic seed based on species and window
  const speciesRiskBaselines: Record<SpeciesType, { prob: number; severity: IncidentSeverity }> = {
    'Asian Elephant': { prob: 76, severity: 'Critical' },
    'Bengal Tiger': { prob: 54, severity: 'High' },
    'Indian Leopard': { prob: 65, severity: 'High' },
    'Sloth Bear': { prob: 40, severity: 'Moderate' },
    'Wild Boar': { prob: 71, severity: 'High' },
    'Gaur': { prob: 28, severity: 'Moderate' },
  };

  const baseline = speciesRiskBaselines[species] || { prob: 52, severity: 'Moderate' };

  // Adjust based on forecast window duration
  let windowAdjustment = 0;
  if (forecastWindow === 'Next 24 Hours') windowAdjustment = -4;
  if (forecastWindow === 'Next 3 Days') windowAdjustment = 3;
  if (forecastWindow === 'Next 7 Days') windowAdjustment = 6;
  if (forecastWindow === 'Next 14 Days') windowAdjustment = 10;

  // Apply environmental modifier boosts from UI checkboxes
  const cropAdjustment = cropMaturityBoost
    ? species === 'Asian Elephant' || species === 'Wild Boar'
      ? 6
      : 3
    : -5;
  const streamAdjustment = streamScarcityBoost ? 5 : -5;

  const probabilityScore = Math.min(
    95,
    Math.max(20, baseline.prob + windowAdjustment + cropAdjustment + streamAdjustment)
  );
  let overallRiskLevel: IncidentSeverity = 'Moderate';
  if (probabilityScore >= 80) overallRiskLevel = 'Critical';
  else if (probabilityScore >= 60) overallRiskLevel = 'High';
  else if (probabilityScore >= 40) overallRiskLevel = 'Moderate';
  else overallRiskLevel = 'Low';

  const cropFactorScore = cropMaturityBoost
    ? species === 'Asian Elephant' || species === 'Wild Boar'
      ? 92
      : 62
    : 28;
  const cropFactorImpact: 'High' | 'Medium' | 'Low' =
    cropFactorScore >= 75 ? 'High' : cropFactorScore >= 45 ? 'Medium' : 'Low';

  const waterFactorScore = streamScarcityBoost ? 82 : 34;
  const waterFactorImpact: 'High' | 'Medium' | 'Low' =
    waterFactorScore >= 75 ? 'High' : waterFactorScore >= 45 ? 'Medium' : 'Low';

  const factorList = [
    {
      factor: 'Crop Ripening Index (Paddy & Sugarcane)',
      score: cropFactorScore,
      impact: cropFactorImpact,
      description: cropMaturityBoost
        ? 'Active paddy/sugarcane harvest season in peripheral agricultural lands attracting herds during dusk.'
        : 'Sugarcane harvest modifier disabled — baseline non-harvest forage attraction assumed.',
    },
    {
      factor: 'Waterhole Dry-up & Stream Retreat',
      score: waterFactorScore,
      impact: waterFactorImpact,
      description: streamScarcityBoost
        ? 'Dry season regression of interior perennial streams forcing wildlife toward village irrigation canals.'
        : 'Hydrology deficit modifier disabled — normal interior waterhole availability assumed.',
    },
    {
      factor: 'Corridor Chokepoint Encroachment',
      score: 84,
      impact: 'High' as const,
      description: 'Linear infrastructure road construction bottlenecking traditional migratory pathway.',
    },
    {
      factor: 'Nocturnal Illumination & Human Activity',
      score: species === 'Indian Leopard' ? 88 : 58,
      impact: (species === 'Indian Leopard' ? 'High' : 'Medium') as 'High' | 'Medium' | 'Low',
      description: 'Peripheral livestock sheds with unfortified chain-link barriers near dense lantana brush.',
    },
    {
      factor: 'Lunar Phase & Canopy Cover Darkness',
      score: 72,
      impact: 'Medium' as const,
      description: 'New moon dark phase historically corresponds to a 38% spike in stealth village entries.',
    },
  ];

  return {
    species,
    district,
    forecastWindow,
    generatedAt: new Date().toISOString(),
    overallRiskLevel,
    probabilityScore,
    confidenceRating: 88,
    contributingFactors: factorList,
    priorityVillages: [
      {
        villageName: `${district} - Kadambur Fringe`,
        riskScore: Math.min(96, probabilityScore + 7),
        predictedPeakWindow: '20:30 - 02:30 IST',
        likelyCorridor: 'Northern Stream Gully (Sector 4B)',
        vulnerabilityReason: 'Sugarcane cultivation adjoining broken solar power fence boundary.',
      },
      {
        villageName: `${district} - Marapallam Settlement`,
        riskScore: Math.min(90, probabilityScore + 2),
        predictedPeakWindow: '22:00 - 04:00 IST',
        likelyCorridor: 'Teak Plantation Ridge (Beat 12)',
        vulnerabilityReason: 'Frequent livestock grazing in buffer zone without protective night pens.',
      },
      {
        villageName: `${district} - Solakarai Colony`,
        riskScore: Math.max(30, probabilityScore - 12),
        predictedPeakWindow: '03:00 - 06:00 IST',
        likelyCorridor: 'South Foothill Pass',
        vulnerabilityReason: 'Active open waste dumping site near peripheral tribal colony.',
      },
    ],
    recommendedPatrolPriorities: [
      {
        priority: 1,
        action: 'Deploy Rapid Response Team (RRT) Vehicle with Thermal Scanners',
        targetZone: 'Northern Stream Gully & Kadambur Agricultural Border',
        suggestedUnit: 'Sector 4 RRT Patrol Unit Alpha',
        operationalWindow: '19:00 - 04:00 IST',
      },
      {
        priority: 2,
        action: 'Inspect and Energize Elephant-Proof Trench (EPT) & Solar Fence lines',
        targetZone: 'Marapallam Perimeter Fencing (Pylons 42 to 88)',
        suggestedUnit: 'Forest Beat Squad Charlie',
        operationalWindow: '14:00 - 18:00 IST (Pre-dusk verification)',
      },
      {
        priority: 3,
        action: 'Broadcast Public Address Audio Warning to Farmers & Panchayat',
        targetZone: 'Kadambur and Solakarai Village Centers',
        suggestedUnit: 'Community Forest Officer Liaison',
        operationalWindow: '17:30 IST prior to dusk return',
      },
      {
        priority: 4,
        action: 'Position Kumki Elephant Support / Sirens at Buffer Outpost',
        targetZone: 'Sector 4 Outpost Camp',
        suggestedUnit: 'Specialized Wildlife Veterinary & Tracking Squad',
        operationalWindow: 'Standby 24h',
      },
    ],
    isDemoEstimate: true,
  };
}
