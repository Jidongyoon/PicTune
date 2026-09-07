import { NextRequest, NextResponse } from "next/server";

const MUSIC_WORKER_URL = process.env.MUSIC_WORKER_URL ?? "http://localhost:8002";
const DEFAULT_BGM_SECONDS = 8;
const MIN_BGM_SECONDS = 1;
const MAX_BGM_SECONDS = 30;

export async function POST(req: NextRequest) {
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, seconds }),
  });

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
