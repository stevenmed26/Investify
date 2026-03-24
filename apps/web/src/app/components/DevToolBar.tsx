"use client";

import { useState } from "react";

// Hide this toolbar by setting NEXT_PUBLIC_DEV_TOOLS=false in .env
// It renders nothing in production when that var is unset or false.
const SHOW = process.env.NEXT_PUBLIC_DEV_TOOLS !== "false";

const API    = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
const ML_URL = process.env.NEXT_PUBLIC_ML_BASE_URL  ?? "http://localhost:8000";

type Step = "idle" | "ingest" | "backfill" | "train" | "done" | "error";

type StepResult = { label: string; ok: boolean; detail?: string };

export default function DevToolbar() {
  const [open, setOpen]     = useState(false);
  const [step, setStep]     = useState<Step>("idle");
  const [log, setLog]       = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);

  if (!SHOW) return null;

  function addLog(r: StepResult) {
    setLog(prev => [...prev, r]);
  }

  async function runPipeline() {
    setRunning(true);
    setStep("idle");
    setLog([]);

    // ── Step 1: Batch ingest ──────────────────────────────────────────────
    setStep("ingest");
    try {
      const r = await fetch(`${API}/api/v1/admin/ingest/batch/history?days=365&delay_ms=500`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Ingest failed");
      const ok  = (d.results ?? []).filter((x: {error?:string}) => !x.error).length;
      const bad = (d.results ?? []).filter((x: {error?:string}) =>  x.error).length;
      addLog({ label: "Batch Ingest", ok: true, detail: `${ok} ok, ${bad} failed` });
    } catch (e: unknown) {
      addLog({ label: "Batch Ingest", ok: false, detail: e instanceof Error ? e.message : "Failed" });
      setStep("error"); setRunning(false); return;
    }

    // ── Step 2: Batch backfill ────────────────────────────────────────────
    setStep("backfill");
    try {
      const r = await fetch(`${API}/api/v1/admin/features/batch/backfill`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Backfill failed");
      const ok  = (d.results ?? []).filter((x: {error?:string}) => !x.error).length;
      addLog({ label: "Feature Backfill", ok: true, detail: `${ok} tickers` });
    } catch (e: unknown) {
      addLog({ label: "Feature Backfill", ok: false, detail: e instanceof Error ? e.message : "Failed" });
      setStep("error"); setRunning(false); return;
    }

    // ── Step 3: Train ─────────────────────────────────────────────────────
    setStep("train");
    try {
      const r = await fetch(`/api/train?horizon_days=5`, {
        method: "POST", credentials: "include",
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail ?? d.error ?? "Training failed");
      const acc = d.accuracy != null ? `${(d.accuracy * 100).toFixed(1)}% acc` : "";
      addLog({ label: "Train Model", ok: true, detail: `${d.rows ?? "?"} rows · ${acc}` });
    } catch (e: unknown) {
      addLog({ label: "Train Model", ok: false, detail: e instanceof Error ? e.message : "Failed" });
      setStep("error"); setRunning(false); return;
    }

    setStep("done");
    setRunning(false);
  }

  const stepLabels: Record<Step, string> = {
    idle:     "Run Pipeline",
    ingest:   "Ingesting prices…",
    backfill: "Building features…",
    train:    "Training model…",
    done:     "Pipeline complete ✓",
    error:    "Pipeline failed ✗",
  };

  return (
    <>
      <style>{STYLES}</style>
      <div className="dev-toolbar">
        {/* Toggle button */}
        <button
          className="dev-toggle"
          onClick={() => setOpen(v => !v)}
          title="Dev tools"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
          </svg>
          <span className="dev-label">DEV</span>
        </button>

        {/* Panel */}
        {open && (
          <div className="dev-panel">
            <div className="dev-panel-header">
              <span>Dev Pipeline</span>
              <span className="dev-env-badge">⚠ DEV ONLY</span>
            </div>

            <div className="dev-steps">
              {(["ingest","backfill","train"] as const).map((s, i) => (
                <div key={s} className={`dev-step ${step === s && running ? "dev-step-active" : ""}`}>
                  <span className="dev-step-num">{i + 1}</span>
                  <span>{s === "ingest" ? "Batch Ingest (365d)" : s === "backfill" ? "Generate Features" : "Train Model"}</span>
                  {step === s && running && <span className="dev-spinner" />}
                </div>
              ))}
            </div>

            {/* Log */}
            {log.length > 0 && (
              <div className="dev-log">
                {log.map((l, i) => (
                  <div key={i} className={`dev-log-row ${l.ok ? "dev-log-ok" : "dev-log-fail"}`}>
                    <span>{l.ok ? "✓" : "✗"} {l.label}</span>
                    {l.detail && <span className="dev-log-detail">{l.detail}</span>}
                  </div>
                ))}
              </div>
            )}

            <button
              className={`dev-run-btn ${step === "done" ? "dev-run-done" : step === "error" ? "dev-run-error" : ""}`}
              onClick={runPipeline}
              disabled={running}
            >
              {running ? stepLabels[step] : step === "done" ? "Run Again" : "Run Full Pipeline"}
            </button>

            <p className="dev-note">
              Ingest uses 500ms delay. Remove this component or set<br/>
              <code>NEXT_PUBLIC_DEV_TOOLS=false</code> to hide.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

const STYLES = `
  .dev-toolbar {
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  }
  .dev-toggle {
    display: flex; align-items: center; gap: 6px;
    padding: 8px 12px; background: #1e293b;
    border: 1px solid rgba(251,191,36,0.3); border-radius: 10px;
    color: #fbbf24; font-size: 11px; font-weight: 700;
    font-family: 'DM Mono', monospace; letter-spacing: 0.08em;
    cursor: pointer; transition: all 0.15s; box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .dev-toggle:hover { border-color: rgba(251,191,36,0.6); background: #263148; }
  .dev-label { letter-spacing: 0.1em; }

  .dev-panel {
    background: #0f172a; border: 1px solid rgba(251,191,36,0.2);
    border-radius: 14px; padding: 16px; width: 280px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.6);
    display: flex; flex-direction: column; gap: 10px;
    animation: dev-in 0.15s ease;
  }
  @keyframes dev-in { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }

  .dev-panel-header {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 12px; font-weight: 700; font-family: 'Syne', sans-serif; color: #f5f7fb;
  }
  .dev-env-badge {
    font-size: 9px; padding: 2px 6px; border-radius: 4px;
    background: rgba(251,191,36,0.1); color: #fbbf24;
    font-family: 'DM Mono', monospace; letter-spacing: 0.06em;
  }

  .dev-steps { display: flex; flex-direction: column; gap: 4px; }
  .dev-step {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px; border-radius: 7px;
    font-size: 11px; font-family: 'DM Mono', monospace; color: #4b5563;
    background: rgba(255,255,255,0.02); border: 1px solid transparent;
    transition: all 0.15s;
  }
  .dev-step-active { color: #f5f7fb; border-color: rgba(251,191,36,0.2); background: rgba(251,191,36,0.05); }
  .dev-step-num {
    width: 18px; height: 18px; border-radius: 50%;
    background: rgba(255,255,255,0.06); color: #6b7280;
    font-size: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .dev-spinner {
    width: 12px; height: 12px; margin-left: auto;
    border: 1.5px solid rgba(251,191,36,0.2); border-top-color: #fbbf24;
    border-radius: 50%; animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .dev-log { display: flex; flex-direction: column; gap: 3px; }
  .dev-log-row {
    display: flex; justify-content: space-between; align-items: center;
    font-size: 10px; font-family: 'DM Mono', monospace;
    padding: 4px 8px; border-radius: 5px;
  }
  .dev-log-ok   { background: rgba(74,222,128,0.07); color: #4ade80; }
  .dev-log-fail { background: rgba(248,113,113,0.07); color: #f87171; }
  .dev-log-detail { color: inherit; opacity: 0.6; font-size: 9px; }

  .dev-run-btn {
    padding: 9px 14px; background: #6366f1; color: #fff;
    border: none; border-radius: 8px; font-size: 12px; font-weight: 600;
    font-family: 'Syne', sans-serif; cursor: pointer;
    transition: background 0.15s, opacity 0.15s; width: 100%;
  }
  .dev-run-btn:hover:not(:disabled) { background: #4f46e5; }
  .dev-run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .dev-run-done  { background: #059669 !important; }
  .dev-run-error { background: #dc2626 !important; }

  .dev-note {
    font-size: 9px; color: #374151; font-family: 'DM Mono', monospace;
    line-height: 1.5; margin: 0;
  }
  .dev-note code { color: #6b7280; background: rgba(255,255,255,0.05);
    padding: 1px 4px; border-radius: 3px; }
`;