"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "pictune-theme";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  // 하이드레이션 직후 실제 테마(초기화 스크립트가 이미 정해둔 값)를 읽어온다.
  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
    setTheme(next);
  }

  // 마운트 전에는 실제 테마를 몰라 아이콘을 확정할 수 없으므로, 자리만 차지하는
  // 빈 버튼을 렌더링해 레이아웃 흔들림과 하이드레이션 불일치를 막는다.
  if (theme === null) {
    return <button type="button" className="theme-toggle" aria-hidden="true" tabIndex={-1} />;
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <line x1="12" y1="1.5" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22.5" />
            <line x1="1.5" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22.5" y2="12" />
            <line x1="4.6" y1="4.6" x2="6.3" y2="6.3" />
            <line x1="17.7" y1="17.7" x2="19.4" y2="19.4" />
            <line x1="4.6" y1="19.4" x2="6.3" y2="17.7" />
            <line x1="17.7" y1="6.3" x2="19.4" y2="4.6" />
          </g>
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
          <path d="M20.7 15.3a8.5 8.5 0 0 1-10-11 8.5 8.5 0 1 0 10 11Z" />
        </svg>
      )}
    </button>
  );
}
