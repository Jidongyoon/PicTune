import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PicTune",
  description: "이미지를 넣으면 분위기에 맞는 8초 BGM을 만들어줍니다",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
