"use client";

import { useState, useRef, useEffect } from "react";

interface User { id: string; email: string; }
interface Holding {
  id: string; symbol: string; company_name: string;
  shares_owned: number; average_cost_basis?: number;
}

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    credentials: "include", body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
async function apiGet(path: string) {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
async function apiDelete(path: string) {
  const res = await fetch(`${API}${path}`, { method: "DELETE", credentials: "include" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

function LoginCard({ user, onAuth }: { user: User | null; onAuth: (u: User | null) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(""); setLoading(true);
    try {
      const data = await apiPost(`/api/v1/auth/${mode}`, { email, password });
      onAuth({ id: data.id, email: data.email }); setEmail(""); setPassword("");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }
  async function handleLogout() {
    setLoading(true);
    try { await apiPost("/api/v1/auth/logout", {}); onAuth(null); }
    finally { setLoading(false); }
  }

  if (user) return (
    <div className="hm-card">
      <p className="hm-label">Signed in as</p>
      <p className="hm-value" title={user.email}>{user.email}</p>
      <button className="hm-btn hm-btn-ghost" onClick={handleLogout} disabled={loading}>
        {loading ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );

  return (
    <div className="hm-card">
      <div className="hm-tab-row">
        <button className={`hm-tab ${mode==="login"?"hm-tab-active":""}`} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
        <button className={`hm-tab ${mode==="register"?"hm-tab-active":""}`} onClick={() => { setMode("register"); setError(""); }}>Register</button>
      </div>
      <input className="hm-input" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
      <input className="hm-input" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode==="login"?"current-password":"new-password"} />
      {error && <p className="hm-error">{error}</p>}
      <button className="hm-btn hm-btn-primary" onClick={handleSubmit} disabled={loading}>
        {loading ? "…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </div>
  );
}

function ApiKeyCard({ user }: { user: User | null }) {
  const [apiKey, setApiKey] = useState(""); const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!user) { setConfigured(null); return; }
    apiGet("/api/v1/admin/provider-status").then(d => setConfigured(d.api_key_configured ?? false)).catch(() => setConfigured(false));
  }, [user]);

  async function handleSave() {
    if (!apiKey.trim()) return; setSaving(true); setMessage(null);
    try {
      await apiPost("/api/v1/admin/secrets/twelvedata", { api_key: apiKey });
      setConfigured(true); setApiKey(""); setMessage({ text: "Saved.", ok: true });
    } catch (e: unknown) { setMessage({ text: e instanceof Error ? e.message : "Failed", ok: false }); }
    finally { setSaving(false); }
  }

  if (!user) return (
    <div className="hm-card hm-card-muted">
      <p className="hm-label">Twelve Data API Key</p>
      <p className="hm-hint">Sign in to configure.</p>
    </div>
  );

  return (
    <div className="hm-card">
      <div className="hm-status-row">
        <p className="hm-label" style={{flex:1}}>Twelve Data API Key</p>
        <span className={`hm-dot ${configured?"hm-dot-green":"hm-dot-dim"}`} />
        <span className="hm-hint">{configured===null?"Checking…":configured?"Configured":"Not set"}</span>
      </div>
      <input className="hm-input" type="password" placeholder={configured?"Replace key…":"Paste API key…"} value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="off" />
      {message && <p className={message.ok?"hm-success":"hm-error"}>{message.text}</p>}
      <button className="hm-btn hm-btn-primary" onClick={handleSave} disabled={saving || !apiKey.trim()}>
        {saving ? "Saving…" : "Save key"}
      </button>
    </div>
  );
}

function ProfileCard({ user }: { user: User | null }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(false);
  const [sym, setSym] = useState(""); const [shares, setShares] = useState(""); const [basis, setBasis] = useState("");
  const [adding, setAdding] = useState(false); const [error, setError] = useState("");

  async function load() {
    if (!user) return; setLoading(true);
    try { const d = await apiGet("/api/v1/holdings"); setHoldings(d.holdings ?? []); }
    catch { setHoldings([]); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [user]);

  async function handleAdd() {
    if (!sym || !shares) return; setAdding(true); setError("");
    try {
      await apiPost("/api/v1/holdings/by-symbol", {
        symbol: sym.toUpperCase(), shares_owned: Number(shares),
        average_cost_basis: basis ? Number(basis) : undefined,
      });
      setSym(""); setShares(""); setBasis(""); await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setAdding(false); }
  }

  async function handleDelete(id: string) {
    try { await apiDelete(`/api/v1/holdings/${id}`); setHoldings(p => p.filter(h => h.id !== id)); }
    catch { /* silent */ }
  }

  if (!user) return (
    <div className="hm-card hm-card-muted">
      <p className="hm-label">Portfolio</p>
      <p className="hm-hint">Sign in to manage holdings.</p>
    </div>
  );

  return (
    <div className="hm-card" style={{gap:10}}>
      <p className="hm-label">Your Holdings</p>
      {loading ? <p className="hm-hint">Loading…</p> :
       holdings.length === 0 ? <p className="hm-hint">No holdings yet.</p> : (
        <div className="hm-holdings-list">
          {holdings.map(h => (
            <div key={h.id} className="hm-holding-row">
              <div className="hm-holding-info">
                <span className="hm-holding-symbol">{h.symbol}</span>
                <span className="hm-holding-detail">
                  {h.shares_owned} shares{h.average_cost_basis ? ` · avg $${Number(h.average_cost_basis).toFixed(2)}` : ""}
                </span>
              </div>
              <button className="hm-holding-del" onClick={() => handleDelete(h.id)} aria-label={`Remove ${h.symbol}`}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="hm-add-row">
        <input className="hm-input hm-input-sm" placeholder="Symbol (e.g. AAPL)" value={sym} onChange={e => setSym(e.target.value.toUpperCase())} />
        <input className="hm-input hm-input-sm" placeholder="Shares" type="number" min="0" value={shares} onChange={e => setShares(e.target.value)} />
        <input className="hm-input hm-input-sm" placeholder="Avg cost (optional)" type="number" min="0" step="0.01" value={basis} onChange={e => setBasis(e.target.value)} />
      </div>
      {error && <p className="hm-error">{error}</p>}
      <button className="hm-btn hm-btn-primary" onClick={handleAdd} disabled={adding || !sym || !shares}>
        {adding ? "Adding…" : "Add holding"}
      </button>
    </div>
  );
}

type Tab = "account" | "apikey";

export function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("account");
  const [user, setUser] = useState<User | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet("/api/v1/auth/me").then(d => setUser({ id: d.id, email: d.email })).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h);
  }, []);

  return (
    <>
      <style>{STYLES}</style>
      <div className="hm-root" ref={ref}>
        <button className={`hm-trigger ${open?"hm-trigger-open":""}`}
          onClick={() => setOpen(v => !v)}
          aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          <span className="hm-bar" /><span className="hm-bar" /><span className="hm-bar" />
          {user && <span className="hm-badge" />}
        </button>

        {open && (
          <div className="hm-panel" role="dialog" aria-label="Account panel">
            <div className="hm-tabs">
              {(["account","apikey"] as Tab[]).map(t => (
                <button key={t} className={`hm-tab-btn ${tab===t?"hm-tab-btn-active":""}`} onClick={() => setTab(t)}>
                  {t==="account"?"Account":"API Key"}
                </button>
              ))}
            </div>
            {tab==="account" && <LoginCard user={user} onAuth={u => { setUser(u); }} />}
            {tab==="apikey"  && <ApiKeyCard user={user} />}
            {user && (
              <a href="/profile" className="hm-profile-link" onClick={() => setOpen(false)}>
                <span className="hm-profile-link-icon">
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 2a4 4 0 100 8 4 4 0 000-8zm-7 14a7 7 0 0114 0H3z"/>
                  </svg>
                </span>
                My Portfolio
                <span className="hm-profile-link-arrow">→</span>
              </a>
            )}
          </div>
        )}
      </div>
    </>
  );
}

const STYLES = `
  .hm-root { position: relative; display: inline-block; color: #f5f7fb; }
  .hm-trigger {
    position: relative; display: flex; flex-direction: column; justify-content: center;
    gap: 5px; width: 40px; height: 40px; padding: 9px 8px; background: transparent;
    border: 1px solid rgba(255,255,255,0.12); border-radius: 9px; cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .hm-trigger:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.22); }
  .hm-bar { display: block; height: 2px; border-radius: 2px; background: #f5f7fb;
    transition: transform 0.22s, opacity 0.22s; transform-origin: center; }
  .hm-trigger-open .hm-bar:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  .hm-trigger-open .hm-bar:nth-child(2) { opacity: 0; transform: scaleX(0); }
  .hm-trigger-open .hm-bar:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
  .hm-badge { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px;
    border-radius: 50%; background: #4ade80; border: 1.5px solid #0b1020; }
  .hm-panel {
    position: absolute; right: 0; top: calc(100% + 10px); width: 320px;
    background: #111827; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6); padding: 8px;
    display: flex; flex-direction: column; gap: 6px; z-index: 9999;
    animation: hm-in 0.18s cubic-bezier(.4,0,.2,1);
  }
  @keyframes hm-in { from { opacity:0; transform:translateY(-8px) scale(0.97); } to { opacity:1; transform:translateY(0) scale(1); } }
  .hm-tabs { display: flex; gap: 2px; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 3px; }
  .hm-tab-btn { flex:1; padding: 6px 4px; font-size: 11px; font-weight: 500; border: none;
    border-radius: 6px; background: transparent; color: #6b7280; cursor: pointer;
    transition: background 0.15s, color 0.15s; font-family: 'DM Mono', monospace; letter-spacing: 0.02em; }
  .hm-tab-btn-active { background: rgba(255,255,255,0.1); color: #f5f7fb; }
  .hm-card { display: flex; flex-direction: column; gap: 8px; padding: 14px;
    border-radius: 10px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); }
  .hm-card-muted { opacity: 0.55; }
  .hm-tab-row { display: flex; gap: 4px; background: rgba(0,0,0,0.25); border-radius: 7px; padding: 3px; }
  .hm-tab { flex:1; padding: 5px 8px; font-size: 12px; font-weight: 500; border: none;
    border-radius: 5px; background: transparent; color: #9ca3af; cursor: pointer; transition: background 0.15s, color 0.15s; }
  .hm-tab-active { background: rgba(255,255,255,0.1); color: #f5f7fb; }
  .hm-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; margin: 0; }
  .hm-value { font-size: 13px; font-weight: 500; color: #f5f7fb; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hm-hint { font-size: 12px; color: #6b7280; margin: 0; }
  .hm-status-row { display: flex; align-items: center; gap: 6px; }
  .hm-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
  .hm-dot-green { background: #4ade80; } .hm-dot-dim { background: #374151; }
  .hm-input { width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px;
    border: 1px solid rgba(255,255,255,0.1); border-radius: 7px; background: rgba(0,0,0,0.3);
    color: #f5f7fb; outline: none; transition: border-color 0.15s, box-shadow 0.15s; font-family: 'DM Mono', monospace; }
  .hm-input:focus { border-color: rgba(99,102,241,0.6); box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
  .hm-input::placeholder { color: #4b5563; font-family: system-ui, sans-serif; }
  .hm-input-sm { font-size: 12px; padding: 6px 8px; }
  .hm-btn { width: 100%; padding: 8px 12px; font-size: 13px; font-weight: 500; border-radius: 7px;
    border: none; cursor: pointer; transition: background 0.15s, opacity 0.15s; font-family: 'DM Mono', monospace; }
  .hm-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .hm-btn-primary { background: #6366f1; color: #fff; }
  .hm-btn-primary:hover:not(:disabled) { background: #4f46e5; }
  .hm-btn-ghost { background: rgba(255,255,255,0.06); color: #9ca3af; border: 1px solid rgba(255,255,255,0.1); }
  .hm-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.1); }

  .hm-profile-link {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; border-radius: 9px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(99,102,241,0.08);
    color: #818cf8; font-size: 13px; font-weight: 600;
    text-decoration: none; font-family: 'Syne', sans-serif;
    transition: all 0.15s;
  }
  .hm-profile-link:hover { background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.3); }
  .hm-profile-link-icon { display: flex; align-items: center; opacity: 0.8; }
  .hm-profile-link-arrow { margin-left: auto; opacity: 0.5; font-size: 14px; }
  .hm-error { font-size: 12px; color: #f87171; margin: 0; }
  .hm-success { font-size: 12px; color: #4ade80; margin: 0; }
  .hm-holdings-list { display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto; }
  .hm-holding-row { display: flex; align-items: center; justify-content: space-between;
    padding: 6px 8px; border-radius: 6px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); }
  .hm-holding-info { display: flex; flex-direction: column; gap: 1px; }
  .hm-holding-symbol { font-family: 'DM Mono', monospace; font-size: 13px; font-weight: 500; color: #f5f7fb; }
  .hm-holding-detail { font-size: 11px; color: #6b7280; font-family: 'DM Mono', monospace; }
  .hm-holding-del { background: none; border: none; color: #4b5563; font-size: 11px;
    cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: color 0.15s, background 0.15s; }
  .hm-holding-del:hover { color: #f87171; background: rgba(248,113,113,0.1); }
  .hm-add-row { display: flex; flex-direction: column; gap: 5px; }
`;