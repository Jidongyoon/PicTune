export default function ResultPlayer({
  audioUrl,
  imageUrl,
  prompt,
  onReset,
}: {
  audioUrl: string;
  imageUrl: string | null;
  prompt: string | null;
  onReset: () => void;
}) {
  return (
    <div className="card result">
      <p className="result-title">BGM이 완성됐어요</p>

      {imageUrl && (
        <div className="preview result-image">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="BGM을 만든 이미지" />
        </div>
      )}

      <audio controls autoPlay src={audioUrl} />

      {prompt && (
        <div className="prompt-box result-prompt">
          <span className="prompt-label">생성에 사용된 프롬프트</span>
          <p className="prompt-text">{prompt}</p>
        </div>
      )}

      <div className="row">
        <a href={audioUrl} download="pictune-bgm.wav" className="btn-primary">
          다운로드
        </a>
        <button type="button" className="btn-secondary" onClick={onReset}>
          다른 이미지로 다시 만들기
        </button>
      </div>
    </div>
  );
}
