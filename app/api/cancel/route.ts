import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const jobId = body?.jobId;
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return NextResponse.json({ error: "유효한 작업 ID가 필요합니다." }, { status: 400 });
  }
  const workers = [
    process.env.VLM_WORKER_URL ?? "http://localhost:8001",
    process.env.MUSIC_WORKER_URL ?? "http://localhost:8002",
  ];
  // Mark BOTH stages, including the one that has not received its request yet.
  const results = await Promise.allSettled(workers.map(async (url) => {
    const response = await fetch(`${url}/cancel/${jobId}`, {
      method: "POST", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("worker cancellation failed");
    return response.status;
  }));
  if (results.some((result) => result.status === "rejected")) {
    return NextResponse.json({ error: "서버의 작업 중단을 확인하지 못했어요. 취소를 다시 눌러주세요." }, { status: 502 });
  }
  if (results.some((result) => result.status === "fulfilled" && result.value === 202)) {
    return NextResponse.json({ status: "cancelling" }, { status: 202 });
  }
  return NextResponse.json({ status: "cancelled" });
}
