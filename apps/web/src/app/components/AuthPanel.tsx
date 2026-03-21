"use client";

import { useEffect, useState } from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";

type Me = {
  id: string;
  email: string;
};

export default function AuthPanel() {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadMe() {
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        setMe(null);
        return;
      }

      const data = await res.json();
      setMe(data);
    } catch {
      setMe(null);
    }
  }

  useEffect(() => {
    loadMe();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus(data.error ?? `${mode} failed`);
        return;
      }

      setStatus(mode === "login" ? "Logged in." : "Registered and logged in.");
      setEmail("");
      setPassword("");
      await loadMe();
    } catch {
      setStatus("Request failed");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    setLoading(true);
    setStatus(null);

    try {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });

      setMe(null);
      setStatus("Logged out.");
    } catch {
      setStatus("Logout failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-2xl font-semibold">Account</h2>

      {me ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-300">Signed in as {me.email}</p>
          <button
            type="button"
            onClick={logout}
            disabled={loading}
            className="rounded-xl bg-white px-4 py-2 font-medium text-slate-900 disabled:opacity-50"
          >
            {loading ? "Working..." : "Logout"}
          </button>
        </div>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`rounded-xl px-4 py-2 text-sm ${mode === "register" ? "bg-white text-slate-900" : "border border-white/10 bg-black/20 text-white"}`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`rounded-xl px-4 py-2 text-sm ${mode === "login" ? "bg-white text-slate-900" : "border border-white/10 bg-black/20 text-white"}`}
            >
              Login
            </button>
          </div>

          <form onSubmit={submit} className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto]">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-white outline-none"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-white px-5 py-3 font-medium text-slate-900 disabled:opacity-50"
            >
              {loading ? "Working..." : mode === "login" ? "Login" : "Register"}
            </button>
          </form>
        </>
      )}

      {status ? <p className="mt-3 text-sm text-slate-300">{status}</p> : null}
    </section>
  );
}