"use client";

import { useEffect, useState } from "react";

// 실제 진행률을 알려주는 API가 없어, 로컬 CPU 실측치를 기준으로 경과 시간에서
// 예상 진행률을 그린다. 이미지 분석(VLM) 단계는 BGM 길이와 무관하게 걸리고,
// 음악 생성 단계는 요청한 길이(seconds)에 비례해 걸리므로 8초 BGM 기준
// 실측치(분석 약 20초 + 생성 약 55초 = 75초)를 요청 길이에 맞게 배분한다.
// 추정이 빗나가도 막대가 먼저 100%에 도달하지 않도록 CEILING에서 멈춘다.
const VLM_ESTIMATE_SECONDS = 20;
const MUSIC_ESTIMATE_SECONDS_PER_SECOND = 55 / 8;
const CEILING = 0.95;

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = String(Math.max(0, totalSeconds) % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function ProgressView({
  prompt,
  seconds,
  onCancel,
  cancelling,
  cancelError,
}: {
  prompt: string | null;
  seconds: number;
  onCancel: () => void;
  cancelling: boolean;
  cancelError: string | null;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const estimatedSeconds = Math.round(
    VLM_ESTIMATE_SECONDS + MUSIC_ESTIMATE_SECONDS_PER_SECOND * seconds,
  );
  const ratio = Math.min(elapsed / estimatedSeconds, CEILING);
  const percent = Math.round(ratio * 100);
  const overdue = elapsed >= estimatedSeconds;
  const remaining = estimatedSeconds - elapsed;

  return (
    <div className="card progress" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p className="progress-title">이미지를 분석하고 BGM을 만드는 중이에요</p>

      <div className="progress-bar-wrap">
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="예상 진행률"
        >
          <div
            className={`progress-bar-fill${overdue ? " is-overdue" : ""}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="progress-bar-meta">
          <span className="elapsed">경과 {formatClock(elapsed)}</span>
          <span className="elapsed">
            {overdue ? "곧 완료돼요" : `남은 시간 약 ${formatClock(remaining)}`}
          </span>
        </div>
      </div>

      {prompt && (
        <div className="prompt-box">
          <span className="prompt-label">생성 프롬프트</span>
          <p className="prompt-text">{prompt}</p>
        </div>
      )}

      <p className="progress-note">
        모델이 CPU에서 동작해 약 {formatClock(estimatedSeconds)} 정도 걸려요. 표시된
        시간은 예상치예요.
        <br />
        페이지를 닫지 말고 기다려주세요.
      </p>

      {cancelError && <p role="alert">{cancelError}</p>}
      <button type="button" className="btn-secondary" onClick={onCancel} disabled={cancelling}>
        {cancelling ? "작업 중단 중…" : "취소"}
      </button>
    </div>
  );
}
