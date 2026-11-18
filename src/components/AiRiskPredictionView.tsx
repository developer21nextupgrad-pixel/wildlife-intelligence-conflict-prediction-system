import React, { useState } from 'react';
import { SpeciesType, PredictionResult } from '../types';
import { apiBridge } from '../services/apiBridge';
import {
  Sparkles,
  Play,
  Info,
  MapPin,
  ShieldCheck,
  Printer,
  Sliders,
  TrendingUp,
  Activity,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

export const AiRiskPredictionView: React.FC = () => {
  // Input parameters
  const [selectedSpecies, setSelectedSpecies] = useState<SpeciesType>('Asian Elephant');
  const [selectedDistrict, setSelectedDistrict] = useState('Bandipur Reserve Division');
  const [forecastWindow, setForecastWindow] = useState<
    'Next 24 Hours' | 'Next 3 Days' | 'Next 7 Days' | 'Next 14 Days'
  >('Next 24 Hours');
  const [cropMaturityBoost, setCropMaturityBoost] = useState(true);
  const [streamScarcityBoost, setStreamScarcityBoost] = useState(true);

  // Execution state
  const [isRunning, setIsRunning] = useState(false);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [dispatchedAlert, setDispatchedAlert] = useState(false);

  // Run the analysis with selected modifier checkboxes
  const handleRunAnalysis = async () => {
    setIsRunning(true);
    setDispatchedAlert(false);
    try {
      const result = await apiBridge.executePrediction(
        selectedSpecies,
        selectedDistrict,
        forecastWindow,
        {
          cropMaturityBoost,
          streamScarcityBoost,
        }
      );
      setPrediction(result);
    } catch (err) {
      console.error('Prediction simulation failed', err);
    } finally {
      setIsRunning(false);
    }
  };

  const handleDispatchPatrol = () => {
    setDispatchedAlert(true);
  };

  const factorChartData =
    prediction?.contributingFactors.map((f) => ({
      factor: f.factor.length > 22 ? f.factor.slice(0, 20) + '...' : f.factor,
      score: f.score,
      fullFactor: f.factor,
    })) || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Government Warning & Demo Disclosure Banner */}
      <div className="bg-amber-950/60 border-l-4 border-amber-500 border border-amber-800/60 p-4 rounded-r-xl shadow-xs">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-100 space-y-1">
            <div className="font-extrabold uppercase tracking-wider flex items-center gap-2">
              <span>DEMO ESTIMATE NOTICE — PROTOTYPE SIMULATION</span>
              <span className="bg-amber-900/90 text-amber-200 border border-amber-700/70 px-1.5 py-0.2 rounded font-mono text-[10px]">
                NO ML BACKEND CONNECTED
              </span>
            </div>
            <p className="leading-relaxed text-amber-200/90">
              Predictions displayed below are deterministic, calibrated demo estimates generated client-side to test Forest Department dispatch, triage, and patrol workflows. No trained machine learning model is executing in this phase.
            </p>
          </div>
        </div>
      </div>

      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-purple-400 font-bold uppercase tracking-wider">
            <span>Spatial Conflict Forecaster</span>
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400"></span>
            <span>Simulated Scenario Engine (DEMO)</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            Conflict Risk & Movement Probability Analysis
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Configure species, division sector, forecast horizon, crop maturity, and hydrology deficit parameters.
          </p>
        </div>

        {prediction && (
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs sm:text-sm font-semibold px-3 py-2 rounded-lg border border-slate-700 shadow-xs transition self-start sm:self-auto"
          >
            <Printer className="w-4 h-4 text-slate-400" />
            <span>Print Dispatch Briefing</span>
          </button>
        )}
      </div>

      {/* Analysis Configuration Card */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-6 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2 text-sm font-bold text-white">
            <Sliders className="w-4 h-4 text-purple-400" />
            <span>Forecast Parameter Configuration</span>
          </div>
          <span className="text-[11px] font-mono text-purple-300 bg-purple-950/70 px-2 py-0.5 rounded border border-purple-800/60">
            Heuristic Simulation (DEMO)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Parameter 1: Species */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              1. Target Wildlife Species
            </label>
            <select
              aria-label="Target Wildlife Species"
              value={selectedSpecies}
              onChange={(e) => setSelectedSpecies(e.target.value as SpeciesType)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-semibold text-slate-200 focus:ring-1 focus:ring-purple-500 focus:outline-hidden"
            >
              <option value="Asian Elephant">Asian Elephant (Elephas maximus)</option>
              <option value="Bengal Tiger">Bengal Tiger (Panthera tigris)</option>
              <option value="Indian Leopard">Indian Leopard (Panthera pardus)</option>
              <option value="Sloth Bear">Sloth Bear (Melursus ursinus)</option>
              <option value="Wild Boar">Wild Boar (Sus scrofa)</option>
              <option value="Gaur">Gaur / Indian Bison (Bos gaurus)</option>
            </select>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Applies species-specific demo conflict baseline weights.
            </span>
          </div>

          {/* Parameter 2: District / Division */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              2. Forest Division / Buffer Sector
            </label>
            <select
              aria-label="Forest Division or Buffer Sector"
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-semibold text-slate-200 focus:ring-1 focus:ring-purple-500 focus:outline-hidden"
            >
              <option value="Bandipur Reserve Division">Bandipur Reserve Division</option>
              <option value="Hediyala Peripheral Sector">Hediyala Peripheral Sector</option>
              <option value="Gundlupet Agricultural Buffer">Gundlupet Agricultural Buffer</option>
              <option value="Maddur Wildlife Corridor">Maddur Wildlife Corridor</option>
              <option value="Omkar Beat Fringe">Omkar Beat Fringe</option>
            </select>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Targets peripheral village profiles for the selected zone.
            </span>
          </div>

          {/* Parameter 3: Forecast Horizon */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1.5">
              3. Forecast Prediction Window
            </label>
            <select
              aria-label="Forecast Prediction Window"
              value={forecastWindow}
              onChange={(e) =>
                setForecastWindow(
                  e.target.value as 'Next 24 Hours' | 'Next 3 Days' | 'Next 7 Days' | 'Next 14 Days'
                )
              }
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs font-semibold text-slate-200 focus:ring-1 focus:ring-purple-500 focus:outline-hidden"
            >
              <option value="Next 24 Hours">Next 24 Hours (Tactical Shift)</option>
              <option value="Next 3 Days">Next 3 Days (Weekend Readiness)</option>
              <option value="Next 7 Days">Next 7 Days (Weekly Roster)</option>
              <option value="Next 14 Days">Next 14 Days (Bi-weekly Horizon)</option>
            </select>
            <span className="text-[10px] text-slate-400 mt-1 block">
              Cumulative encounter likelihood increases across longer horizons.
            </span>
          </div>
        </div>

        {/* Environmental Modifiers */}
        <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cropMaturityBoost}
                onChange={(e) => setCropMaturityBoost(e.target.checked)}
                className="w-4 h-4 accent-purple-500 rounded border-slate-700 bg-slate-950"
              />
              <span className="font-semibold text-slate-200">Account for Sugarcane Harvest</span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={streamScarcityBoost}
                onChange={(e) => setStreamScarcityBoost(e.target.checked)}
                className="w-4 h-4 accent-purple-500 rounded border-slate-700 bg-slate-950"
              />
              <span className="font-semibold text-slate-200">
                Include Dry Season Hydrology Deficit
              </span>
            </label>
          </div>

          <button
            onClick={handleRunAnalysis}
            disabled={isRunning}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs sm:text-sm px-5 py-2.5 rounded-lg shadow-sm transition active:scale-95 disabled:opacity-50"
          >
            {isRunning ? (
              <>
                <Activity className="w-4 h-4 animate-spin" />
                <span>Simulating Matrix...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white" />
                <span>Run Conflict Analysis (Demo)</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* RESULTS DISPLAY */}
      {prediction && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-3">
          {/* Top Prediction Summary Banner */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-sm p-6 grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
            {/* Risk Gauge */}
            <div className="md:col-span-2 flex items-center space-x-4 border-b md:border-b-0 md:border-r border-slate-800 pb-4 md:pb-0 md:pr-4">
              <div
                className={`w-20 h-20 rounded-2xl flex flex-col items-center justify-center font-extrabold text-white shadow-md shrink-0 ${
                  prediction.overallRiskLevel === 'Critical'
                    ? 'bg-red-600'
                    : prediction.overallRiskLevel === 'High'
                    ? 'bg-amber-600'
                    : 'bg-emerald-600'
                }`}
              >
                <span className="text-2xl font-mono tabular-nums">{prediction.probabilityScore}%</span>
                <span className="text-[10px] uppercase tracking-wider font-semibold">Demo Risk</span>
              </div>

              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                      prediction.overallRiskLevel === 'Critical'
                        ? 'bg-red-950 text-red-300 border border-red-800/60'
                        : prediction.overallRiskLevel === 'High'
                        ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                        : 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                    }`}
                  >
                    {prediction.overallRiskLevel} Risk Horizon
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    Demo Confidence: {prediction.confidenceRating}%
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-1">
                  Simulated Conflict Cluster: {prediction.species}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Target: {prediction.district} • Horizon: {prediction.forecastWindow}
                </p>
              </div>
            </div>

            {/* Simulated Scenario Parameters */}
            <div className="text-xs space-y-1.5">
              <span className="text-slate-400 font-bold uppercase text-[10px]">
                Simulated Modifiers Applied
              </span>
              <div className="font-semibold text-slate-200">
                Crop Harvest Boost: {cropMaturityBoost ? 'Active' : 'Disabled'}
              </div>
              <div className="font-semibold text-slate-200">
                Hydrology Deficit: {streamScarcityBoost ? 'Active' : 'Disabled'}
              </div>
              <div className="text-amber-300 font-mono text-[10px]">
                DEMO ESTIMATE ONLY
              </div>
            </div>

            {/* Quick Simulated Dispatch CTA */}
            <div>
              <button
                onClick={handleDispatchPatrol}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 px-4 rounded-xl shadow-sm text-xs transition flex items-center justify-center gap-2"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {dispatchedAlert ? 'Demo Alert Logged Locally ✓' : 'Simulate QRT Alert Order (DEMO)'}
                </span>
              </button>
              <span className="text-[10px] text-slate-400 text-center block mt-1">
                Prototype UI action only — no SMS or VHF hardware dispatch
              </span>
            </div>
          </div>

          {/* Factor Weight Bar Chart (Actively renders factorChartData) */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div>
                <h4 className="font-bold text-sm text-white">
                  Simulated Risk Factor Weight Profile
                </h4>
                <p className="text-xs text-slate-400">
                  Visualizes how active species, crop maturity, and hydrology modifiers contribute to the demo estimate
                </p>
              </div>
              <span className="text-[10px] font-mono bg-purple-950 text-purple-300 px-2 py-0.5 rounded border border-purple-800/60">
                DEMO FACTORS
              </span>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={factorChartData} margin={{ top: 10, right: 20, left: -10, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="factor" tick={{ fontSize: 10, fill: '#94a3b8' }} interval={0} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#020617',
                      borderColor: '#334155',
                      color: '#fff',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                  />
                  <Bar dataKey="score" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Grid 2: Contributing Factors & Priority Villages */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Contributing Risk Factors */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm text-white flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-purple-400" />
                    Contributing Ecological & Human Factors
                  </h4>
                  <span className="text-[10px] font-mono bg-purple-950 text-purple-300 px-2 py-0.5 rounded border border-purple-800/60 font-semibold">
                    Demo Weights
                  </span>
                </div>

                <div className="space-y-3 mt-4 text-xs">
                  {prediction.contributingFactors.map((factor, idx) => (
                    <div
                      key={idx}
                      className="space-y-1 bg-slate-950 p-2.5 rounded-lg border border-slate-800"
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span className="text-slate-200">{factor.factor}</span>
                        <span
                          className={`font-mono text-[11px] font-bold ${
                            factor.impact === 'High'
                              ? 'text-red-400'
                              : factor.impact === 'Medium'
                              ? 'text-amber-400'
                              : 'text-emerald-400'
                          }`}
                        >
                          {factor.score}/100 ({factor.impact} Impact)
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            factor.impact === 'High'
                              ? 'bg-red-500'
                              : factor.impact === 'Medium'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                          style={{ width: `${factor.score}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{factor.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Priority Villages at Risk */}
            <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-bold text-sm text-white flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-red-400" />
                    Priority Vulnerable Settlements (Demo)
                  </h4>
                  <span className="text-[10px] font-mono bg-red-950 text-red-300 px-2 py-0.5 rounded border border-red-800/60 font-semibold">
                    Simulated Ranking
                  </span>
                </div>

                <div className="space-y-3 mt-4 text-xs">
                  {prediction.priorityVillages.map((vil, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border border-slate-800 bg-slate-950 space-y-2"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono text-slate-400 font-bold">
                            PRIORITY #{idx + 1}
                          </span>
                          <h5 className="font-bold text-white text-sm">{vil.villageName}</h5>
                        </div>
                        <div className="text-right">
                          <span className="text-red-400 font-extrabold font-mono text-sm tabular-nums">
                            {vil.riskScore}%
                          </span>
                          <div className="text-[10px] text-slate-400 font-semibold">
                            Peak: {vil.predictedPeakWindow}
                          </div>
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-400 space-y-0.5">
                        <div>
                          <span className="font-semibold text-slate-300">Likely Corridor:</span>{' '}
                          {vil.likelyCorridor}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-300">Vulnerability:</span>{' '}
                          {vil.vulnerabilityReason}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Recommended Field Patrol & Mitigation Priorities */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-xs p-6">
            <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
              <div>
                <h4 className="font-bold text-base text-white flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  Simulated Patrol & Mitigation Recommendations (DEMO)
                </h4>
                <p className="text-xs text-slate-400">
                  Sample standard operating actions generated for prototype demonstration.
                </p>
              </div>
              <span className="text-xs font-bold text-emerald-400 font-mono">
                {prediction.recommendedPatrolPriorities.length} Directives
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {prediction.recommendedPatrolPriorities.map((item) => (
                <div
                  key={item.priority}
                  className="p-3.5 rounded-xl border border-emerald-900/60 bg-emerald-950/20 space-y-2 flex flex-col justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="bg-emerald-700 text-white font-mono text-[10px] font-bold px-2 py-0.5 rounded">
                        DIRECTIVE #{item.priority}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400 font-semibold">
                        {item.operationalWindow}
                      </span>
                    </div>
                    <div className="font-bold text-white text-sm mt-1">{item.action}</div>
                  </div>

                  <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400 space-y-0.5">
                    <div>
                      <span className="font-semibold text-slate-300">Target Zone:</span>{' '}
                      {item.targetZone}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-300">Suggested Unit:</span>{' '}
                      <span className="font-semibold text-emerald-400">{item.suggestedUnit}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Empty State before running analysis */}
      {!prediction && !isRunning && (
        <div className="bg-slate-900 rounded-2xl border border-slate-800 p-12 text-center shadow-xs">
          <div className="w-14 h-14 bg-purple-950 text-purple-400 border border-purple-800/60 rounded-full flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-white">
            Configure Parameters and Execute Simulated Analysis
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto mt-1">
            Select the wildlife species, forest buffer sector, forecast window, and environmental modifiers above, then click &quot;Run Conflict Analysis (Demo)&quot;.
          </p>
        </div>
      )}
    </div>
  );
};
