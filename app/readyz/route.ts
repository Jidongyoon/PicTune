const VLM_WORKER_URL = process.env.VLM_WORKER_URL ?? "http://localhost:8001";
const MUSIC_WORKER_URL = process.env.MUSIC_WORKER_URL ?? "http://localhost:8002";
const HEALTHCHECK_TIMEOUT_MS = 6_000;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function isHealthy(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const [vlm, music] = await Promise.all([
    isHealthy(VLM_WORKER_URL),
    isHealthy(MUSIC_WORKER_URL),
  ]);
  const ready = vlm && music;

  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      dependencies: { vlm, music },
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
