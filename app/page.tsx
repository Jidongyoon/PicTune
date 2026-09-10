"use client";

import { useRef, useState } from "react";
import ImageUploader from "@/app/components/ImageUploader";
import ProgressView from "@/app/components/ProgressView";
import ResultPlayer from "@/app/components/ResultPlayer";

type Status = "idle" | "uploading" | "done" | "error";

function createJobId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // randomUUID() is unavailable on non-secure origins such as an HTTP IP address.
  // getRandomValues() remains available there, so build an RFC 4122 UUID v4.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [duration, setDuration] = useState(8);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // 업로더가 언마운트되면 그쪽 objectURL은 해제되므로, 결과 화면용 미리보기는 여기서 따로 만든다.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const jobRef = useRef<string | null>(null);
  const cancellingRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleSubmit(file: File, seconds: number) {
    if (jobRef.current) return;
    const jobId = createJobId();
    jobRef.current = jobId;
    setCancelError(null);
    setStatus("uploading");
    setErrorMessage(null);
    setPrompt(null);
    setDuration(seconds);
    setImageUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return URL.createObjectURL(file);
    });

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("image", file);

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        headers: { "x-job-id": jobId },
        signal: controller.signal,
      });

      if (!analyzeRes.ok) {
        const body = await analyzeRes.json().catch(() => null);
        throw new Error(body?.error ?? `이미지 분석에 실패했습니다 (${analyzeRes.status})`);
      }

      const { musicgen_prompt: musicgenPrompt } = await analyzeRes.json();
      controller.signal.throwIfAborted();
      setPrompt(musicgenPrompt);

      const musicRes = await fetch("/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-job-id": jobId },
        body: JSON.stringify({ prompt: musicgenPrompt, seconds }),
        signal: controller.signal,
      });

      if (!musicRes.ok) {
        const body = await musicRes.json().catch(() => null);
        throw new Error(body?.error ?? `BGM 생성에 실패했습니다 (${musicRes.status})`);
      }

      const blob = await musicRes.blob();
      controller.signal.throwIfAborted();
      setAudioUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted) return; // 사용자가 취소한 경우 에러로 취급하지 않는다.
      setErrorMessage(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    } finally {
      if (controllerRef.current === controller && !controller.signal.aborted) {
        controllerRef.current = null;
        jobRef.current = null;
      }
    }
  }

  async function handleCancel() {
    const jobId = jobRef.current;
    if (!jobId || cancellingRef.current) return;
    cancellingRef.current = true;
    setCancelling(true);
    setCancelError(null);
    controllerRef.current?.abort();
    try {
      while (true) {
        const response = await fetch("/api/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId }),
          signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw new Error("cancel failed");
        if (response.status !== 202) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      jobRef.current = null;
      controllerRef.current = null;
      setPrompt(null);
      clearImage();
      setStatus("idle");
    } catch {
      setCancelError("서버의 작업 중단을 확인하지 못했어요. 취소를 다시 눌러주세요.");
    } finally {
      cancellingRef.current = false;
      setCancelling(false);
    }
  }

  function clearImage() {
    setImageUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }

  function handleReset() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    clearImage();
    setStatus("idle");
    setErrorMessage(null);
    setPrompt(null);
  }

  return (
    <main className="page">
      <header className="header">
        <span className="logo-badge">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="PicTune" className="logo" />
        </span>
        <p>이미지를 넣으면 분위기에 맞는 BGM을 만들어드려요.</p>
      </header>

      {status === "idle" && <ImageUploader onSubmit={handleSubmit} />}
      {status === "uploading" && (
        <ProgressView prompt={prompt} seconds={duration} onCancel={handleCancel} cancelling={cancelling} cancelError={cancelError} />
      )}
      {status === "done" && audioUrl && (
        <ResultPlayer audioUrl={audioUrl} imageUrl={imageUrl} prompt={prompt} onReset={handleReset} />
      )}
      {status === "error" && (
        <div className="card">
          <div className="alert" role="alert">
            <p>{errorMessage}</p>
          </div>
          <button type="button" className="btn-primary" onClick={handleReset}>
            다시 시도
          </button>
        </div>
      )}
    </main>
  );
}
