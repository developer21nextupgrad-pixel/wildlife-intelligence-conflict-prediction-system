export type SpeciesType = 'Asian Elephant' | 'Bengal Tiger' | 'Indian Leopard' | 'Sloth Bear' | 'Wild Boar' | 'Gaur';

export type IncidentSeverity = 'Low' | 'Moderate' | 'High' | 'Critical';

export type IncidentStatus = 'Reported' | 'Verified' | 'Patrol Dispatched' | 'Under Control' | 'Resolved' | 'Closed';

export type IncidentType = 
  | 'Crop Depredation' 
  | 'Human Injury / Attack' 
  | 'Livestock Predation' 
  | 'Property / House Damage' 
  | 'Village Incursion' 
  | 'Infrastructure Breach';

export interface Incident {
  id: string;
  incidentCode: string;
  species: SpeciesType;
  dateTime: string;
  latitude: number;
  longitude: number;
  village: string;
  district: string;
  forestRange: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  humanInjury: 'None' | 'Minor' | 'Severe' | 'Fatal';
  humanInjuriesCount: number;
  livestockLossCount: number;
  cropDamageEstimatedAcres: number;
  cropType?: string;
  description: string;
  imageUrl?: string;
  status: IncidentStatus;
  reportedBy: string;
  assignedOfficer?: string;
  actionTaken?: string;
  isDemo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AnimalSighting {
  id: string;
  sightingCode: string;
  species: SpeciesType;
  timestamp: string;
  latitude: number;
  longitude: number;
  locationName: string;
  district?: string;
  forestRange: string;
  herdSize: number;
  movementDirection: 'North' | 'North-East' | 'East' | 'South-East' | 'South' | 'South-West' | 'West' | 'North-West' | 'Stationary';
  bearingDegrees: number;
  behavior: 'Foraging' | 'Moving towards village' | 'Near waterhole' | 'Aggressive / Agitated' | 'Resting';
  juvenilesPresent: boolean;
  observationDetails: string;
  observerName: string;
  observerRole: string;
  verifiedByForestGuard: boolean;
  photoUrl?: string;
  isDemo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface RiskZone {
  id: string;
  name: string;
  district: string;
  range: string;
  riskLevel: IncidentSeverity;
  riskScore: number; // 0 - 100
  dominantSpecies: SpeciesType;
  centerCoordinates: [number, number];
  polygonCoordinates: [number, number][];
  activeAlertCount: number;
  primaryRiskFactor: string;
}

export interface VillageRiskProfile {
  id: string;
  name: string;
  district: string;
  population: number;
  households: number;
  forestDistanceKm: number;
  coordinates: [number, number];
  riskLevel: IncidentSeverity;
  riskScore: number;
  activeSolarFence: boolean;
  fenceStatus: 'Operational' | 'Breached' | 'Maintenance Required';
  assignedRRT: string;
  emergencyContact: string;
  recentIncidents30d: number;
}

export interface AlertNotification {
  id: string;
  title: string;
  message: string;
  severity: IncidentSeverity;
  species: SpeciesType;
  affectedVillage: string;
  district: string;
  coordinates: [number, number];
  alertTime: string;
  triggeredAt?: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  assignedOfficer?: string;
  responseStatus: 'Pending Dispatch' | 'RRT En Route' | 'On Scene' | 'Area Cleared' | 'False Alarm';
  isDemo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PredictionFactor {
  factor: string;
  score: number; // 0-100
  impact: 'High' | 'Medium' | 'Low';
  description: string;
}

export interface PredictionResult {
  species: SpeciesType;
  district: string;
  forecastWindow: 'Next 24 Hours' | 'Next 3 Days' | 'Next 7 Days' | 'Next 14 Days';
  generatedAt: string;
  overallRiskLevel: IncidentSeverity;
  probabilityScore: number; // percentage 0-100
  confidenceRating: number; // percentage 0-100
  contributingFactors: PredictionFactor[];
  priorityVillages: {
    villageName: string;
    riskScore: number;
    predictedPeakWindow: string;
    likelyCorridor: string;
    vulnerabilityReason: string;
  }[];
  recommendedPatrolPriorities: {
    priority: number;
    action: string;
    targetZone: string;
    suggestedUnit: string;
    operationalWindow: string;
  }[];
  isDemoEstimate: true;
}

export interface TelemetryCollar {
  id: string;
  animalId: string;
  animalName: string;
  species: SpeciesType;
  collarBattery: number;
  lastPingTime: string;
  currentLat: number;
  currentLng: number;
  speedKmH: number;
  direction: string;
  status: 'In Forest Core' | 'Approaching Boundary' | 'Geo-fence Breached' | 'Signal Degraded';
  trail: [number, number][];
}

export interface UserStaff {
  id: string;
  name: string;
  badgeNumber: string;
  role: 'Chief Conservator' | 'Divisional Forest Officer (DFO)' | 'Range Forest Officer (RFO)' | 'RRT Lead' | 'Beat Guard' | 'Wildlife Biologist';
  assignedBeat: string;
  contactNumber: string;
  email: string;
  status: 'On Duty' | 'Patrol Active' | 'Standby' | 'On Leave';
  avatarInitials: string;
}

export interface PatrolOperation {
  id: string;
  patrolCode: string;
  teamName: string;
  leadOfficer: string;
  targetArea: string;
  sector: string;
  district?: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'In Progress' | 'On Station' | 'Scheduled' | 'Completed' | 'Standby';
  scheduledWindow: string;
  activePersonnel: number;
  equipment: string[];
  riskRationale: string;
  approvedBy: string;
  coordinates: [number, number];
  isDemo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}
