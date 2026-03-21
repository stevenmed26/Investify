import { NextRequest, NextResponse } from "next/server";



const API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ?? "http://api:8080";

const ML_BASE_URL =
  process.env.INTERNAL_ML_BASE_URL ?? "http://ml-service:8000";

export async function POST(req: NextRequest) {
  // Validate the session cookie against the Go API first
  const cookie = req.cookies.get("investify_token");
  if (!cookie?.value) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const authRes = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
    headers: { Cookie: `investify_token=${cookie.value}` },
    cache: "no-store",
  }).catch(() => null);

  if (!authRes || !authRes.ok) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Forward query params (symbol, horizon_days) to the ML service
  const { searchParams } = new URL(req.url);
  const mlUrl = new URL(`${ML_BASE_URL}/train`);
  searchParams.forEach((value, key) => mlUrl.searchParams.set(key, value));

  const mlRes = await fetch(mlUrl.toString(), {
    method: "POST",
    cache: "no-store",
  }).catch(() => null);

  if (!mlRes) {
    return NextResponse.json(
      { error: "ML service unreachable" },
      { status: 502 }
    );
  }

  const body = await mlRes.json().catch(() => ({}));
  return NextResponse.json(body, { status: mlRes.status });
}