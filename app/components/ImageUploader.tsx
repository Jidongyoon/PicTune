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

  // 브라우저 창 전체를 드롭 영역으로 취급한다. 이미지가 이미 선택된 상태여도
  // 새로 끌어다 놓으면 기존 이미지를 교체한다.
  // dragenter/dragleave가 자식 요소를 넘나들 때도 튀지 않도록 진입 횟수를 센다.
  useEffect(() => {
    let depth = 0;

    function onDragEnter(e: DragEvent) {
      e.preventDefault();
      depth++;
      setIsDragging(true);
    }
    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      depth = 0;
      setIsDragging(false);
      selectFile(e.dataTransfer?.files?.[0] ?? null);
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  function clearFile() {
    setFile(null);
    setPreviewUrl(null);
    setWarning(null);
    if (inputRef.current) inputRef.current.value = "";
  }

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
          <button
            type="button"
            className="remove-button"
            onClick={clearFile}
            aria-label="이미지 제거"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="선택한 이미지 미리보기" />
          <div className="preview-meta">
            <span className="preview-name">
              {file.name} · {formatSize(file.size)}
            </span>
            <button
              type="button"
              className="link-button"
              onClick={() => inputRef.current?.click()}
            >
              변경
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className={`dropzone${isDragging ? " is-dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
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
