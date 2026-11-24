import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeterministicUploadKey,
  formatReidDecisionBadge,
  formatSightingLinkBanner,
  validateAlertRuleInput,
  validateLocationContextInputs,
} from './animalIntelligence';

test('formatReidDecisionBadge renders honest labels for every decision state', () => {
  const newInd = formatReidDecisionBadge({
    decision: 'new_individual',
    reviewStatus: 'auto_accepted',
    animalCode: 'ELE-001',
    similarityScore: null,
  });
  assert.equal(newInd.label, 'New ID ELE-001');
  assert.equal(newInd.tone, 'sky');

  const matched = formatReidDecisionBadge({
    decision: 'matched_existing',
    reviewStatus: 'auto_accepted',
    animalCode: 'ELE-001',
    similarityScore: 0.912,
  });
  assert.equal(matched.label, 'Matched ELE-001');
  assert.equal(matched.tone, 'emerald');
  assert.equal(matched.similarityText, '91.2% cosine');

  const review = formatReidDecisionBadge({
    decision: 'needs_review',
    reviewStatus: 'pending_review',
    animalCode: null,
    similarityScore: 0.642,
  });
  assert.equal(review.label, 'Needs Human Review');
  assert.equal(review.tone, 'amber');

  const legacy = formatReidDecisionBadge({
    decision: null,
    reviewStatus: null,
    animalCode: null,
    similarityScore: null,
  });
  assert.equal(legacy.label, 'Pre-Re-ID Record');

  const disabled = formatReidDecisionBadge({
    decision: 'phase2_not_enabled',
    reviewStatus: null,
    animalCode: null,
    similarityScore: null,
  });
  assert.equal(disabled.label, 'Re-ID Disabled');
});

test('formatSightingLinkBanner reflects linked GPS vs no-fake-GPS status cleanly', () => {
  const linked = formatSightingLinkBanner('linked', '12345678-aaaa-bbbb');
  assert.equal(linked.tone, 'emerald');
  assert.match(linked.title, /12345678/);

  const noGps = formatSightingLinkBanner('location_required_for_sighting', null);
  assert.equal(noGps.tone, 'amber');
  assert.match(noGps.title, /no fake GPS/i);
});

test('validateLocationContextInputs requires paired valid GPS coords or both blank', () => {
  assert.deepEqual(validateLocationContextInputs({ latitude: '', longitude: '' }), { valid: true });
  assert.equal(validateLocationContextInputs({ latitude: '11.66', longitude: '' }).valid, false);
  assert.equal(validateLocationContextInputs({ latitude: '95', longitude: '76.5' }).valid, false);
  assert.deepEqual(validateLocationContextInputs({ latitude: '11.66', longitude: '76.62' }), {
    valid: true,
    latitude: 11.66,
    longitude: 76.62,
  });
});

test('validateAlertRuleInput checks rule fields strictly', () => {
  assert.match(validateAlertRuleInput({ name: '  ', minRepeatCount: 1, timeWindowMinutes: 60, minSpeciesConfidence: 0.5 }) || '', /required/i);
  assert.match(validateAlertRuleInput({ name: 'Test', minRepeatCount: 0, timeWindowMinutes: 60, minSpeciesConfidence: 0.5 }) || '', /repeat count/i);
  assert.equal(
    validateAlertRuleInput({
      name: 'Critical Tiger Perimeter',
      minRepeatCount: 1,
      timeWindowMinutes: 60,
      minSpeciesConfidence: 0.6,
    }),
    null
  );
});

test('buildDeterministicUploadKey stays within 128 chars and incorporates salt cleanly', () => {
  const k = buildDeterministicUploadKey({ name: 'elephant crop 1.jpg', size: 12345, lastModified: 999 }, 'abc');
  assert.ok(k.length <= 128);
  assert.match(k, /^wicps-elephant_crop_1\.jpg-12345-999-abc$/);
});
