export default function ResultPlayer({
  audioUrl,
  onReset,
}: {
  audioUrl: string;
  onReset: () => void;
}) {
  return (
    <div>
      <p>BGM 생성이 완료됐습니다.</p>
      <audio controls src={audioUrl} style={{ width: "100%" }} />
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <a href={audioUrl} download="pictune-bgm.wav">
          <button>다운로드</button>
        </a>
        <button onClick={onReset}>다른 이미지로 다시 만들기</button>
      </div>
    </div>
  );
}
