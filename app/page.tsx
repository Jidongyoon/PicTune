"use client";

import { useRef, useState } from "react";
import ImageUploader from "@/app/components/ImageUploader";
import ProgressView from "@/app/components/ProgressView";
import ResultPlayer from "@/app/components/ResultPlayer";

type Status = "idle" | "uploading" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [prompt, setPrompt] = useState<string | null>(null);
  const [duration, setDuration] = useState(8);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function handleSubmit(file: File, seconds: number) {
    setStatus("uploading");
    setErrorMessage(null);
    setPrompt(null);
    setDuration(seconds);

    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("image", file);

      const analyzeRes = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!analyzeRes.ok) {
        const body = await analyzeRes.json().catch(() => null);
        throw new Error(body?.error ?? `이미지 분석에 실패했습니다 (${analyzeRes.status})`);
      }

      const { musicgen_prompt: musicgenPrompt } = await analyzeRes.json();
      setPrompt(musicgenPrompt);

      const musicRes = await fetch("/api/music", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: musicgenPrompt, seconds }),
        signal: controller.signal,
      });

      if (!musicRes.ok) {
        const body = await musicRes.json().catch(() => null);
        throw new Error(body?.error ?? `BGM 생성에 실패했습니다 (${musicRes.status})`);
      }

      const blob = await musicRes.blob();
      setAudioUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (err) {
      if (controller.signal.aborted) return; // 사용자가 취소한 경우 에러로 취급하지 않는다.
      setErrorMessage(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    } finally {
      controllerRef.current = null;
    }
  }

  function handleCancel() {
    controllerRef.current?.abort();
    setStatus("idle");
  }

  function handleReset() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
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
        <ProgressView prompt={prompt} seconds={duration} onCancel={handleCancel} />
      )}
      {status === "done" && audioUrl && (
        <ResultPlayer audioUrl={audioUrl} onReset={handleReset} />
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
