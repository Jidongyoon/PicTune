"use client";

import { useState } from "react";

export default function ImageUploader({
  onSubmit,
}: {
  onSubmit: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null);
  }

  return (
    <div>
      <input type="file" accept="image/*" onChange={handleFileChange} />
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="선택한 이미지 미리보기"
          style={{ maxWidth: "100%", marginTop: 16 }}
        />
      )}
      <div style={{ marginTop: 16 }}>
        <button disabled={!file} onClick={() => file && onSubmit(file)}>
          BGM 생성
        </button>
      </div>
    </div>
  );
}
