import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.INTERNAL_API_BASE_URL ?? "http://api:8080";
const ML_BASE_URL = process.env.INTERNAL_ML_BASE_URL ?? "http://localhost:8000";
const ML_TOKEN = process.env.INTERNAL_ML_TOKEN ?? "dev-ml-internal-token";

async function authorize(req: NextRequest) {
  const cookie = req.cookies.get("investify_token");
  if (!cookie?.value) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const authRes = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
    headers: { Cookie: `investify_token=${cookie.value}` },
    cache: "no-store",
  }).catch(() => null);

  if (!authRes || !authRes.ok) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const me = await authRes.json().catch(() => null);
  if (!me || me.role !== "admin") {
    return { error: NextResponse.json({ error: "admin access required" }, { status: 403 }) };
  }

  return { me };
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req);
  if ("error" in auth) {
    return auth.error;
  }

  const { searchParams } = new URL(req.url);
  const mlUrl = new URL(`${ML_BASE_URL}/train/jobs`);
  searchParams.forEach((value, key) => mlUrl.searchParams.set(key, value));

  const mlRes = await fetch(mlUrl.toString(), {
    method: "POST",
    cache: "no-store",
    headers: {
      "X-Internal-Token": ML_TOKEN,
    },
  }).catch(() => null);

  if (!mlRes) {
    return NextResponse.json({ error: "ML service unreachable" }, { status: 502 });
  }

  const body = await mlRes.json().catch(() => ({}));
  return NextResponse.json(body, { status: mlRes.status });
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if ("error" in auth) {
    return auth.error;
  }

  const jobId = new URL(req.url).searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  const mlRes = await fetch(`${ML_BASE_URL}/train/jobs/${jobId}`, {
    cache: "no-store",
    headers: {
      "X-Internal-Token": ML_TOKEN,
    },
  }).catch(() => null);

  if (!mlRes) {
    return NextResponse.json({ error: "ML service unreachable" }, { status: 502 });
  }

  const body = await mlRes.json().catch(() => ({}));
  return NextResponse.json(body, { status: mlRes.status });
}
