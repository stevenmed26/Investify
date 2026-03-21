"use client";

import { useState, useRef, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface User {
  id: string;
  email: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
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

// ---------------------------------------------------------------------------
// LoginCard
// ---------------------------------------------------------------------------
function LoginCard({
  user,
  onAuth,
}: {
  user: User | null;
  onAuth: (u: User | null) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    setLoading(true);
    try {
      const path =
        mode === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register";
      const data = await apiPost(path, { email, password });
      onAuth({ id: data.id, email: data.email });
      setEmail("");
      setPassword("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    setLoading(true);
    try {
      await apiPost("/api/v1/auth/logout", {});
      onAuth(null);
    } finally {
      setLoading(false);
    }
  }

  if (user) {
    return (
      <div className="hm-card">
        <p className="hm-label">Account</p>
        <p className="hm-value" title={user.email}>
          {user.email}
        </p>
        <button
          className="hm-btn hm-btn-ghost"
          onClick={handleLogout}
          disabled={loading}
        >
          {loading ? "Signing out…" : "Sign out"}
        </button>
      </div>
    );
  }

  return (
    <div className="hm-card">
      <div className="hm-tab-row">
        <button
          className={`hm-tab ${mode === "login" ? "hm-tab-active" : ""}`}
          onClick={() => { setMode("login"); setError(""); }}
        >
          Sign in
        </button>
        <button
          className={`hm-tab ${mode === "register" ? "hm-tab-active" : ""}`}
          onClick={() => { setMode("register"); setError(""); }}
        >
          Register
        </button>
      </div>

      <input
        className="hm-input"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <input
        className="hm-input"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
      />

      {error && <p className="hm-error">{error}</p>}

      <button
        className="hm-btn hm-btn-primary"
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? "…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApiKeyCard
// ---------------------------------------------------------------------------
function ApiKeyCard({ user }: { user: User | null }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    if (!user) { setConfigured(null); return; }
    apiGet("/api/v1/admin/provider-status")
      .then((d) => setConfigured(d.api_key_configured ?? false))
      .catch(() => setConfigured(false));
  }, [user]);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiPost("/api/v1/admin/secrets/twelvedata", { api_key: apiKey });
      setConfigured(true);
      setApiKey("");
      setMessage({ text: "API key saved.", ok: true });
    } catch (e: unknown) {
      setMessage({ text: e instanceof Error ? e.message : "Failed to save key", ok: false });
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <div className="hm-card hm-card-muted">
        <p className="hm-label">Twelve Data API Key</p>
        <p className="hm-hint">Sign in to configure your market data key.</p>
      </div>
    );
  }

  return (
    <div className="hm-card">
      <div className="hm-status-row">
        <p className="hm-label" style={{ flex: 1 }}>Twelve Data API Key</p>
        <span className={`hm-dot ${configured ? "hm-dot-green" : "hm-dot-dim"}`} />
        <span className="hm-hint">
          {configured === null ? "Checking…" : configured ? "Configured" : "Not set"}
        </span>
      </div>

      <input
        className="hm-input"
        type="password"
        placeholder={configured ? "Replace existing key…" : "Paste your API key…"}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        autoComplete="off"
      />

      {message && (
        <p className={message.ok ? "hm-success" : "hm-error"}>{message.text}</p>
      )}

      <button
        className="hm-btn hm-btn-primary"
        onClick={handleSave}
        disabled={saving || !apiKey.trim()}
      >
        {saving ? "Saving…" : "Save key"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HamburgerMenu (main export)
// ---------------------------------------------------------------------------
export function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Restore session on mount
  useEffect(() => {
    apiGet("/api/v1/auth/me")
      .then((d) => setUser({ id: d.id, email: d.email }))
      .catch(() => setUser(null));
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <style>{STYLES}</style>

      <div className="hm-root" ref={ref}>
        <button
          className={`hm-trigger ${open ? "hm-trigger-open" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open account menu"}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          <span className="hm-bar" />
          <span className="hm-bar" />
          <span className="hm-bar" />
          {user && <span className="hm-badge" aria-label="Signed in" />}
        </button>

        {open && (
          <div
            className="hm-panel"
            role="dialog"
            aria-label="Account panel"
          >
            <LoginCard user={user} onAuth={(u) => { setUser(u); }} />
            <ApiKeyCard user={user} />
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles — dark-themed to match the app's #0b1020 background
// ---------------------------------------------------------------------------
const STYLES = `
  /* ---- Root ---- */
  .hm-root {
    position: relative;
    display: inline-block;
    color: #f5f7fb;
  }

  /* ---- Trigger button ---- */
  .hm-trigger {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 40px;
    height: 40px;
    padding: 9px 8px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 9px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .hm-trigger:hover {
    background: rgba(255,255,255,0.07);
    border-color: rgba(255,255,255,0.22);
  }
  .hm-trigger:focus-visible {
    outline: 2px solid rgba(99,102,241,0.7);
    outline-offset: 2px;
  }

  /* Three bars */
  .hm-bar {
    display: block;
    height: 2px;
    border-radius: 2px;
    background: #f5f7fb;
    transition: transform 0.22s cubic-bezier(.4,0,.2,1), opacity 0.22s;
    transform-origin: center;
  }
  .hm-trigger-open .hm-bar:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  .hm-trigger-open .hm-bar:nth-child(2) { opacity: 0; transform: scaleX(0); }
  .hm-trigger-open .hm-bar:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

  /* Signed-in dot */
  .hm-badge {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4ade80;
    border: 1.5px solid #0b1020;
  }

  /* ---- Dropdown panel ---- */
  .hm-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 10px);
    width: 300px;
    background: #111827;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 16px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04);
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 9999;
    animation: hm-in 0.18s cubic-bezier(.4,0,.2,1);
  }
  @keyframes hm-in {
    from { opacity: 0; transform: translateY(-8px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  /* ---- Card ---- */
  .hm-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px;
    border-radius: 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
  }
  .hm-card-muted { opacity: 0.55; }

  /* ---- Tab row (login / register switcher) ---- */
  .hm-tab-row {
    display: flex;
    gap: 4px;
    background: rgba(0,0,0,0.25);
    border-radius: 7px;
    padding: 3px;
  }
  .hm-tab {
    flex: 1;
    padding: 5px 8px;
    font-size: 12px;
    font-weight: 500;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #9ca3af;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .hm-tab-active {
    background: rgba(255,255,255,0.1);
    color: #f5f7fb;
  }

  /* ---- Typography ---- */
  .hm-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b7280;
    margin: 0;
  }
  .hm-value {
    font-size: 13px;
    font-weight: 500;
    color: #f5f7fb;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hm-hint {
    font-size: 12px;
    color: #6b7280;
    margin: 0;
  }

  /* ---- Status row ---- */
  .hm-status-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hm-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .hm-dot-green { background: #4ade80; }
  .hm-dot-dim   { background: #374151; }

  /* ---- Input ---- */
  .hm-input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    font-size: 13px;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 7px;
    background: rgba(0,0,0,0.3);
    color: #f5f7fb;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .hm-input:focus {
    border-color: rgba(99,102,241,0.6);
    box-shadow: 0 0 0 3px rgba(99,102,241,0.15);
  }
  .hm-input::placeholder { color: #4b5563; }

  /* ---- Buttons ---- */
  .hm-btn {
    width: 100%;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 7px;
    border: none;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
  }
  .hm-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  .hm-btn-primary {
    background: #6366f1;
    color: #ffffff;
  }
  .hm-btn-primary:hover:not(:disabled) { background: #4f46e5; }

  .hm-btn-ghost {
    background: rgba(255,255,255,0.06);
    color: #9ca3af;
    border: 1px solid rgba(255,255,255,0.1);
  }
  .hm-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.1); }

  /* ---- Feedback ---- */
  .hm-error   { font-size: 12px; color: #f87171; margin: 0; }
  .hm-success { font-size: 12px; color: #4ade80; margin: 0; }
`;