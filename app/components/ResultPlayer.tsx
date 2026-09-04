export default function ResultPlayer({
  audioUrl,
  onReset,
}: {
  audioUrl: string;
  onReset: () => void;
}) {
  return (
    <div className="card result">
      <p className="result-title">BGM이 완성됐어요</p>
      <audio controls autoPlay src={audioUrl} />
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
