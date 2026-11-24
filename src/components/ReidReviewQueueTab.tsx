import React, { useCallback, useEffect, useState } from 'react';
import { AnimalIdentitySummary, ReidMatchRecord } from '../types';
import { apiBridge } from '../services/apiBridge';
import { formatReidDecisionBadge } from '../utils/animalIntelligence';
import { AuthenticatedUserProfile, canReviewReid } from '../utils/authStorage';
import { AuthImage } from './AuthImage';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';

interface ReidReviewQueueTabProps {
  currentUser: AuthenticatedUserProfile | null;
  onReviewCompleted?: () => void;
}

export const ReidReviewQueueTab: React.FC<ReidReviewQueueTabProps> = ({
  currentUser,
  onReviewCompleted,
}) => {
  const [matches, setMatches] = useState<ReidMatchRecord[]>([]);
  const [identities, setIdentities] = useState<AnimalIdentitySummary[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [needsReviewOnly, setNeedsReviewOnly] = useState<boolean>(false);
  const [decisionFilter, setDecisionFilter] = useState<string>('All');
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  const canReview = canReviewReid(currentUser);
  const [reason, setReason] = useState<string>('');
  const [targetIdentityId, setTargetIdentityId] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [matchRes, idRes] = await Promise.all([
        apiBridge.getReidMatches({
          page: 1,
          pageSize: 50,
          decision: decisionFilter,
          needsReviewOnly,
        }),
        apiBridge.getAnimalIdentities({ page: 1, pageSize: 100 }),
      ]);
      setMatches(matchRes.items);
      setTotal(matchRes.total);
      setIdentities(idRes.items);
      setSelectedMatchId((prev) => {
        if (prev && matchRes.items.some((m) => m.id === prev)) return prev;
        return matchRes.items[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Re-ID match queue.');
    } finally {
      setLoading(false);
    }
  }, [decisionFilter, needsReviewOnly]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeMatch = matches.find((m) => m.id === selectedMatchId) || null;

  useEffect(() => {
    if (activeMatch) {
      setTargetIdentityId(
        activeMatch.matchedAnimalId ||
          activeMatch.suggestedAnimalId ||
          activeMatch.topCandidates[0]?.animalIdentityId ||
          ''
      );
    }
  }, [activeMatch]);

  const handleAction = async (
    action: 'confirm' | 'reject' | 'mark_needs_review' | 'reassign',
    createNewIdentity = false
  ) => {
    if (!activeMatch) return;
    if (!canReview) {
      setError('Reviewer or Admin role is required to submit Re-ID verification decisions.');
      return;
    }
    if (action === 'reassign' && !targetIdentityId) {
      setError('Select a Target Individual Identity for reassignment.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiBridge.reviewReidMatch(activeMatch.id, {
        action,
        reason: reason.trim() || undefined,
        targetAnimalIdentityId:
          action === 'confirm' || action === 'reassign'
            ? targetIdentityId || undefined
            : undefined,
        createNewIdentity,
      });
      setNotice(
        `Match ${updated.id.slice(0, 8)} updated (${updated.reviewStatus})${
          updated.matchedAnimalCode ? ` -> ${updated.matchedAnimalCode}` : ''
        }.`
      );
      setReason('');
      await loadData();
      onReviewCompleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review action.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={needsReviewOnly}
              onChange={(e) => setNeedsReviewOnly(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 text-emerald-500"
            />
            <span>Pending Human Review Only</span>
          </label>
          <select
            value={decisionFilter}
            onChange={(e) => setDecisionFilter(e.target.value)}
            aria-label="Filter Re-ID matches by decision"
            className="bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
          >
            <option value="All">All Decisions</option>
            <option value="needs_review">Needs Review</option>
            <option value="matched_existing">Matched Existing</option>
            <option value="new_individual">New Individual</option>
            <option value="rejected">Rejected</option>
            <option value="reassigned">Reassigned</option>
          </select>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-slate-200 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Queue ({total})</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="bg-red-950/60 border border-red-800 rounded-xl p-3 text-xs text-red-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div role="status" className="bg-emerald-950/60 border border-emerald-800 rounded-xl p-3 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span>Re-ID Match Queue ({total})</span>
          </h2>

          {loading ? (
            <div className="py-10 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Loading Re-ID matches...</span>
            </div>
          ) : matches.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400 bg-slate-950/50 border border-slate-800 rounded-xl px-4">
              No Re-ID match records match the current filter.
            </div>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1" data-testid="reid-match-list">
              {matches.map((m) => {
                const badge = formatReidDecisionBadge({
                  decision: m.decision,
                  reviewStatus: m.reviewStatus,
                  animalCode: m.matchedAnimalCode || m.suggestedAnimalCode,
                  similarityScore: m.similarityScore,
                });
                const isSelected = m.id === selectedMatchId;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMatchId(m.id)}
                    aria-label={`Review match ${m.species} ${m.matchedAnimalCode || m.suggestedAnimalCode || m.id.slice(0, 6)}`}
                    className={`w-full text-left p-3 rounded-xl border transition flex items-center gap-3 ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500/70'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <AuthImage
                      src={m.cropImageUrl}
                      alt={`${m.species} crop`}
                      className="w-14 h-14 rounded-lg object-cover border border-slate-800 shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white truncate">{m.species}</span>
                        {badge.similarityText && (
                          <span className="text-[10px] font-mono text-sky-300 shrink-0">
                            {badge.similarityText}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                        <span className="text-emerald-300">{badge.label}</span>
                        <span className="text-slate-400">{m.reviewStatus}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="xl:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
          {!activeMatch ? (
            <div className="py-16 text-center text-xs text-slate-400">
              Select a Re-ID match record to compare crops and verify or reassign individual identity.
            </div>
          ) : (
            <div className="space-y-5" data-testid="reid-review-workbench">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <div className="text-[11px] font-mono text-slate-400">
                    MATCH RECORD • {activeMatch.id.slice(0, 8)} • {activeMatch.modelVersion}
                  </div>
                  <h3 className="text-base font-bold text-white mt-0.5">{activeMatch.species}</h3>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-amber-300">
                  {activeMatch.reviewStatus}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="text-[11px] font-mono text-slate-400 uppercase">Query Crop</div>
                  <AuthImage
                    src={activeMatch.cropImageUrl}
                    alt="Query animal crop"
                    className="w-full h-44 object-contain bg-slate-900 rounded-lg"
                  />
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                  <div className="text-[11px] font-mono text-slate-400 uppercase">Source Frame</div>
                  <AuthImage
                    src={activeMatch.sourceImageUrl}
                    alt="Source frame"
                    className="w-full h-44 object-contain bg-slate-900 rounded-lg"
                  />
                </div>
              </div>

              {activeMatch.reviewReason && (
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 text-xs text-slate-300">
                  <span className="font-bold text-white">Pipeline Assessment: </span>
                  {activeMatch.reviewReason}
                </div>
              )}

              {/* Candidate Comparison */}
              {activeMatch.topCandidates.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                    Top Reference Candidates (Cosine Similarity)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {activeMatch.topCandidates.slice(0, 3).map((cand) => (
                      <div
                        key={cand.animalIdentityId}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-1.5"
                      >
                        {cand.cropImageUrl && (
                          <AuthImage
                            src={cand.cropImageUrl}
                            alt={cand.animalCode}
                            className="w-full h-24 object-cover rounded-lg border border-slate-800"
                          />
                        )}
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="font-bold text-sky-300">{cand.animalCode}</span>
                          <span className="text-emerald-300">
                            {(cand.similarityScore * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Human Review Controls */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <UserCheck className="w-4 h-4 text-emerald-400" />
                  <span>Human Verification & Audit Decision</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <div className="block text-[11px] font-mono text-slate-400 mb-1">
                      Authenticated Reviewer (Derived from JWT)
                    </div>
                    <div
                      data-testid="authenticated-reviewer-label"
                      className="w-full bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-emerald-300 font-mono truncate"
                    >
                      {currentUser
                        ? `${currentUser.displayName} (${currentUser.role})`
                        : 'Unauthenticated'}
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="reid-target-identity"
                      className="block text-[11px] font-mono text-slate-400 mb-1"
                    >
                      Target Identity (for Confirm / Reassign)
                    </label>
                    <select
                      id="reid-target-identity"
                      value={targetIdentityId}
                      disabled={!canReview || submitting}
                      onChange={(e) => setTargetIdentityId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 disabled:opacity-50"
                    >
                      <option value="">-- Use suggested / select individual --</option>
                      {identities.map((id) => (
                        <option key={id.id} value={id.id}>
                          {id.animalCode} — {id.species} ({id.totalSightings} sightings)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reid-review-reason"
                    className="block text-[11px] font-mono text-slate-400 mb-1"
                  >
                    Verification Reason / Field Note
                  </label>
                  <input
                    id="reid-review-reason"
                    type="text"
                    value={reason}
                    disabled={!canReview || submitting}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g., Ear notch & tusk silhouette verified against ELE-001"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 disabled:opacity-50"
                  />
                </div>

                {!canReview && (
                  <div className="bg-amber-950/50 border border-amber-800/70 rounded-lg px-3 py-2 text-[11px] text-amber-200">
                    Reviewer or Admin role is required to submit Re-ID verification actions.
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={submitting || !canReview}
                    onClick={() => handleAction('confirm')}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-bold transition"
                  >
                    Confirm Match
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !canReview}
                    onClick={() => handleAction('reject', true)}
                    className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-bold transition"
                  >
                    Reject & Allocate New ID
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !canReview}
                    onClick={() => handleAction('reassign')}
                    className="px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-bold transition"
                  >
                    Reassign Selected ID
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !canReview}
                    onClick={() => handleAction('mark_needs_review')}
                    className="px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:bg-slate-800 disabled:text-slate-500 text-white rounded-lg text-xs font-bold transition"
                  >
                    Mark Needs Review
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
