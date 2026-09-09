### 색상표

| 역할             |      색상 | 용도               |
| ---------------- | --------: | ---------------- |
| Primary Purple   | `#7C21FB` | 주요 버튼, 링크, 선택 상태 |
| Secondary Purple | `#6E37FB` | 그라데이션, hover 보조  |
| Audio Cyan       | `#00E6FC` | 음파, 강조 아이콘       |
| Muted Cyan       | `#01DED2` | 배지, 보조 버튼        |
| Deep Navy        | `#071948` | 제목, 본문, 다크 배경    |
| Light Background | `#F8FAFF` | 페이지 배경           |
| Soft Purple      | `#F1E9FF` | 선택 영역, 카드 강조     |
| Border           | `#DCE4F2` | 테두리, 구분선         |
| Muted Text       | `#65708C` | 설명문, 비활성 텍스트     |
| White            | `#FFFFFF` | 카드, 버튼 텍스트       |



### 활용 예시
```
:root {
  /* Brand */
  --pictune-primary: #7c21fb;
  --pictune-primary-alt: #6e37fb;
  --pictune-audio: #00e6fc;
  --pictune-audio-muted: #01ded2;
  --pictune-navy: #071948;

  /* UI */
  --pictune-background: #f8faff;
  --pictune-surface: #ffffff;
  --pictune-primary-soft: #f1e9ff;
  --pictune-border: #dce4f2;
  --pictune-text: #071948;
  --pictune-text-muted: #65708c;

  /* Interaction */
  --pictune-primary-hover: #6416d6;
  --pictune-audio-hover: #00bac9;
  --pictune-focus-ring: rgb(124 33 251 / 25%);

  /* Brand gradient */
  --pictune-gradient:
    linear-gradient(135deg, #7c21fb 0%, #6e37fb 40%, #00e6fc 100%);
}
```

---

```
body {
  color: var(--pictune-text);
  background: var(--pictune-background);
}

.primary-button {
  color: #fff;
  background: var(--pictune-primary);
}

.primary-button:hover {
  background: var(--pictune-primary-hover);
}

.secondary-button {
  color: var(--pictune-navy);
  background: var(--pictune-audio);
}

.brand-gradient {
  background: var(--pictune-gradient);
}
```


