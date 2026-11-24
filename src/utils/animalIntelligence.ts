import { AlertRuleCreateInput } from '../types';

export interface ReidBadgeDisplay {
  label: string;
  tone: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate';
  similarityText: string | null;
}

export function formatReidDecisionBadge(params: {
  decision?: string | null;
  reviewStatus?: string | null;
  animalCode?: string | null;
  similarityScore?: number | null;
}): ReidBadgeDisplay {
  const decision = params.decision || '';
  const reviewStatus = params.reviewStatus || '';
  const similarityText =
    params.similarityScore !== null && params.similarityScore !== undefined
      ? `${(params.similarityScore * 100).toFixed(1)}% cosine`
      : null;

  if (decision === 'not_applicable') {
    return { label: 'Non-Wildlife', tone: 'slate', similarityText: null };
  }
  if (decision === 'phase2_not_enabled') {
    return { label: 'Re-ID Disabled', tone: 'slate', similarityText: null };
  }
  if (!decision) {
    return { label: 'Pre-Re-ID Record', tone: 'slate', similarityText: null };
  }
  if (reviewStatus === 'rejected' || decision === 'rejected') {
    return {
      label: params.animalCode ? `Rejected -> ${params.animalCode}` : 'Match Rejected',
      tone: 'rose',
      similarityText,
    };
  }
  if (decision === 'needs_review' || reviewStatus === 'pending_review') {
    return {
      label: 'Needs Human Review',
      tone: 'amber',
      similarityText,
    };
  }
  if (decision === 'matched_existing' || reviewStatus === 'reassigned') {
    return {
      label: params.animalCode ? `Matched ${params.animalCode}` : 'Matched Existing',
      tone: 'emerald',
      similarityText,
    };
  }
  if (decision === 'new_individual') {
    return {
      label: params.animalCode ? `New ID ${params.animalCode}` : 'New Individual',
      tone: 'sky',
      similarityText,
    };
  }
  return {
    label: params.animalCode || decision,
    tone: 'slate',
    similarityText,
  };
}

export function formatSightingLinkBanner(status?: string | null, sightingId?: string | null): {
  title: string;
  tone: 'emerald' | 'amber' | 'slate';
} {
  if (sightingId) {
    return {
      title: `Linked to Animal Sightings (${sightingId.slice(0, 8)})`,
      tone: 'emerald',
    };
  }
  if (status === 'location_required_for_sighting') {
    return {
      title: 'No GPS/Camera/Village provided — sighting not created (no fake GPS)',
      tone: 'amber',
    };
  }
  if (status === 'species_needs_review') {
    return {
      title: 'Species uncertain — manual review recommended before sighting link',
      tone: 'amber',
    };
  }
  if (status === 'auto_sighting_disabled') {
    return {
      title: 'Auto-sighting linking disabled for this upload',
      tone: 'slate',
    };
  }
  return {
    title: 'No animal sighting generated',
    tone: 'slate',
  };
}

export function validateLocationContextInputs(params: {
  latitude: string;
  longitude: string;
}): { valid: true; latitude?: number; longitude?: number } | { valid: false; error: string } {
  const latStr = params.latitude.trim();
  const lngStr = params.longitude.trim();
  if (!latStr && !lngStr) {
    return { valid: true };
  }
  if (!latStr || !lngStr) {
    return { valid: false, error: 'Provide both latitude and longitude, or leave both blank.' };
  }
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: 'Latitude must be between -90 and 90.' };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { valid: false, error: 'Longitude must be between -180 and 180.' };
  }
  return { valid: true, latitude: lat, longitude: lng };
}

export function validateAlertRuleInput(input: Partial<AlertRuleCreateInput>): string | null {
  if (!input.name || !input.name.trim()) {
    return 'Rule name is required.';
  }
  if (
    input.minRepeatCount === undefined ||
    !Number.isInteger(input.minRepeatCount) ||
    input.minRepeatCount < 1 ||
    input.minRepeatCount > 50
  ) {
    return 'Repeat count threshold must be an integer between 1 and 50.';
  }
  if (
    input.timeWindowMinutes === undefined ||
    !Number.isInteger(input.timeWindowMinutes) ||
    input.timeWindowMinutes < 1 ||
    input.timeWindowMinutes > 10080
  ) {
    return 'Time window must be an integer between 1 and 10080 minutes.';
  }
  if (
    input.minSpeciesConfidence === undefined ||
    !Number.isFinite(input.minSpeciesConfidence) ||
    input.minSpeciesConfidence < 0 ||
    input.minSpeciesConfidence > 1
  ) {
    return 'Minimum species confidence must be between 0.0 and 1.0.';
  }
  return null;
}

export function buildDeterministicUploadKey(file: {
  name: string;
  size: number;
  lastModified?: number;
}, salt: string): string {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 32);
  return `wicps-${safeName}-${file.size}-${file.lastModified ?? 0}-${salt}`.slice(0, 128);
}
