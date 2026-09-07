import type { Metadata } from "next";
import ThemeToggle from "@/app/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "PicTune",
  description: "이미지를 넣으면 분위기에 맞는 8초 BGM을 만들어줍니다",
};

// 저장된 테마(또는 시스템 설정)를 하이드레이션/페인트 이전에 적용해
// 다크 모드에서 밝은 화면이 잠깐 번쩍이는 현상(FOUC)을 막는다.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("pictune-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
