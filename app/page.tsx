"use client";

import { useState } from "react";
import ImageUploader from "@/app/components/ImageUploader";
import ProgressView from "@/app/components/ProgressView";
import ResultPlayer from "@/app/components/ResultPlayer";

type Status = "idle" | "uploading" | "done" | "error";

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(file: File) {
    setStatus("uploading");
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const res = await fetch("/api/generate", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `요청이 실패했습니다 (${res.status})`);
      }

      const blob = await res.blob();
      setAudioUrl(URL.createObjectURL(blob));
      setStatus("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      setStatus("error");
    }
  }

  function handleReset() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setStatus("idle");
    setErrorMessage(null);
  }

  return (
    <main style={{ maxWidth: 480, margin: "48px auto", padding: "0 16px" }}>
      <h1>PicTune</h1>
      <p>이미지를 넣으면 분위기에 맞는 8초 BGM을 만들어드려요.</p>

      {status === "idle" && <ImageUploader onSubmit={handleSubmit} />}
      {status === "uploading" && <ProgressView />}
      {status === "done" && audioUrl && (
        <ResultPlayer audioUrl={audioUrl} onReset={handleReset} />
      )}
      {status === "error" && (
        <div>
          <p style={{ color: "crimson" }}>{errorMessage}</p>
          <button onClick={handleReset}>다시 시도</button>
        </div>
      )}
    </main>
  );
}
