import { NextRequest, NextResponse } from "next/server";

const MUSIC_WORKER_URL = process.env.MUSIC_WORKER_URL ?? "http://localhost:8002";
const DEFAULT_BGM_SECONDS = 8;
const MIN_BGM_SECONDS = 1;
const MAX_BGM_SECONDS = 30;

export async function POST(req: NextRequest) {
  const jobId = req.headers.get("x-job-id");
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return NextResponse.json({ error: "유효한 작업 ID가 필요합니다." }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const prompt = body?.prompt;

  if (typeof prompt !== "string" || prompt.trim() === "") {
    return NextResponse.json({ error: "prompt가 필요합니다." }, { status: 400 });
  }

  const requestedSeconds = Number(body?.seconds);
  const seconds = Number.isFinite(requestedSeconds)
    ? Math.min(MAX_BGM_SECONDS, Math.max(MIN_BGM_SECONDS, requestedSeconds))
    : DEFAULT_BGM_SECONDS;

  const musicRes = await fetch(`${MUSIC_WORKER_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-job-id": jobId },
    body: JSON.stringify({ prompt, seconds }),
  });

  if (musicRes.status === 409) {
    return NextResponse.json({ error: "취소되었거나 이미 처리 중인 작업입니다." }, { status: 409 });
  }

  if (!musicRes.ok) {
    return NextResponse.json(
      { error: `BGM 생성에 실패했습니다 (${musicRes.status})` },
      { status: 502 },
    );
  }

  const audioBuffer = await musicRes.arrayBuffer();

  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": "inline",
    },
  });
}
