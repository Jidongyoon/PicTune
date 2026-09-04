"use client";

import { useEffect, useState } from "react";

// 실제 진행률을 알려주는 API가 없어, 로컬 CPU 실측치(약 60초)를 기준으로
// 경과 시간에서 예상 진행률을 그린다. 추정이 빗나가도 막대가 먼저 100%에
// 도달하지 않도록 CEILING에서 멈춘다.
const ESTIMATED_SECONDS = 75;
const CEILING = 0.95;

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = String(Math.max(0, totalSeconds) % 60).padStart(2, "0");
  return `${m}:${s}`;
}

export default function ProgressView() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const ratio = Math.min(elapsed / ESTIMATED_SECONDS, CEILING);
  const percent = Math.round(ratio * 100);
  const overdue = elapsed >= ESTIMATED_SECONDS;
  const remaining = ESTIMATED_SECONDS - elapsed;

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

      <p className="progress-note">
        모델이 CPU에서 동작해 1~2분 정도 걸려요. 표시된 시간은 예상치예요.
        <br />
        페이지를 닫지 말고 기다려주세요.
      </p>
    </div>
  );
}
