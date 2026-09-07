import { NextRequest, NextResponse } from "next/server";

const VLM_WORKER_URL = process.env.VLM_WORKER_URL ?? "http://localhost:8001";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const image = formData.get("image");

  if (!(image instanceof File)) {
    return NextResponse.json({ error: "image 파일이 필요합니다." }, { status: 400 });
  }

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

  return NextResponse.json({ musicgen_prompt: musicgenPrompt });
}
