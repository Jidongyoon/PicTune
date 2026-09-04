"use client";

import { useEffect, useRef, useState } from "react";

const MAX_SIZE_MB = 10;

function formatSize(bytes: number) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

export default function ImageUploader({
  onSubmit,
}: {
  onSubmit: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 미리보기 objectURL은 교체·언마운트 시점에 반드시 해제한다.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function selectFile(selected: File | null) {
    if (!selected) return;

    if (!selected.type.startsWith("image/")) {
      setWarning("이미지 파일만 올릴 수 있어요.");
      return;
    }
    if (selected.size > MAX_SIZE_MB * 1024 * 1024) {
      setWarning(`${MAX_SIZE_MB}MB 이하 이미지만 올릴 수 있어요.`);
      return;
    }

    setWarning(null);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  function clearFile() {
    setFile(null);
    setPreviewUrl(null);
    setWarning(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    selectFile(e.dataTransfer.files?.[0] ?? null);
  }

  return (
    <div className="stack">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
      />

      {previewUrl && file ? (
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="선택한 이미지 미리보기" />
          <div className="preview-meta">
            <span className="preview-name">
              {file.name} · {formatSize(file.size)}
            </span>
            <button type="button" className="link-button" onClick={clearFile}>
              변경
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone${isDragging ? " is-dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <span className="dropzone-title">이미지를 끌어다 놓으세요</span>
          <span className="dropzone-hint">또는 클릭해서 파일 선택</span>
          <span className="dropzone-hint">JPG · PNG · {MAX_SIZE_MB}MB 이하</span>
        </button>
      )}

      {warning && (
        <div className="alert" role="alert">
          <p>{warning}</p>
        </div>
      )}

      <button
        type="button"
        className="btn-primary"
        disabled={!file}
        onClick={() => file && onSubmit(file)}
      >
        BGM 생성
      </button>
    </div>
  );
}
