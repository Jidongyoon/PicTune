import { NextRequest, NextResponse } from "next/server";

const VLM_WORKER_URL = process.env.VLM_WORKER_URL ?? "http://localhost:8001";
const MUSIC_WORKER_URL = process.env.MUSIC_WORKER_URL ?? "http://localhost:8002";
const BGM_SECONDS = 8;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const image = formData.get("image");

  if (!(image instanceof File)) {
    return NextResponse.json({ error: "image 파일이 필요합니다." }, { status: 400 });
  }

  // 1) VLM Worker: 이미지 → 구조화된 무드 분석 + musicgen_prompt
  const vlmFormData = new FormData();
  vlmFormData.append("image", image);

  const vlmRes = await fetch(`${VLM_WORKER_URL}/caption`, {
    method: "POST",
    body: vlmFormData,
  });

  if (!vlmRes.ok) {
    return NextResponse.json(
      { error: `이미지 분석에 실패했습니다 (${vlmRes.status})` },
      { status: 502 },
    );
  }

  const caption = await vlmRes.json();
  const musicgenPrompt = caption?.musicgen_prompt;

  if (typeof musicgenPrompt !== "string" || musicgenPrompt.trim() === "") {
    return NextResponse.json(
      { error: "이미지 분석 결과에서 musicgen_prompt를 찾지 못했습니다." },
      { status: 502 },
    );
  }

  // 2) Music Worker: musicgen_prompt → WAV binary
  const musicRes = await fetch(`${MUSIC_WORKER_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: musicgenPrompt, seconds: BGM_SECONDS }),
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
