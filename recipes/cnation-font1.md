# cnation 전용 폰트 조합 #1 — IBM Plex Sans KR

cnation-app에 적용한 폰트 조합입니다. 본문과 제목/강조 사이의 조화가 좋고 가독성도 좋아서,
앞으로 다른 cnation 앱/게임에도 같은 조합을 쓰려고 정리해둔 문서입니다.
이 파일 하나만 새 세션에 첨부해서 "이대로 적용해줘"라고 요청하면 됩니다.

## 1. 폰트 정보

| 항목 | 내용 |
|---|---|
| 폰트명 | IBM Plex Sans KR |
| 배포처 | Google Fonts |
| 라이선스 | SIL Open Font License 1.1 (OFL) — 상업적 사용·수정·재배포 가능 |
| 원저작자 | IBM (Mike Abbink, Bold Monday) |
| 원본 다운로드 | `https://github.com/google/fonts` 저장소의 `ofl/ibmplexsanskr/` 폴더 |

### 사용 굵기 (2종만 사용)

| 용도 | 굵기 | 원본 파일명 |
|---|---|---|
| 본문 (설명글, 일반 텍스트) | Regular · 400 | `IBMPlexSansKR-Regular.ttf` |
| 제목 · 강조 · 버튼 등 굵은 글씨 | Bold · 700 | `IBMPlexSansKR-Bold.ttf` |

**적용 규칙**: 앱 전체 텍스트를 이 두 굵기로만 표현합니다. 일반 설명글·본문은 Regular(400),
제목·카테고리명·버튼 텍스트·강조되는 굵은 글씨는 Bold(700). 그 외 굵기(100/200/300/500/600 등)는 쓰지 않습니다.

## 2. 용량 최적화 방법 (서브셋)

Google Fonts CDN에서 그대로 받으면 원본이 큰 데다(각 2.8~2.9MB, 한자·확장 문자셋까지 포함),
Google이 자체적으로 유니코드 구간별로 수십~수백 개 파일로 쪼개서 서빙합니다. 그 대신
**fontTools로 직접 서브셋**해서 필요한 문자만 남긴 단일 woff2 파일을 만들어 자체 호스팅합니다.

### 포함한 문자 범위 (unicode-range)

```
U+0020-007E   기본 라틴 (영문 대소문자, 숫자, 기본 기호)
U+00A0        줄바꿈 없는 공백(nbsp)
U+AC00-D7A3   한글 완성형 전체 음절 (가~힣, 11,172자) — 앞으로 어떤 한글 텍스트가
              추가돼도 다시 작업할 필요 없도록 전체 포함
U+00B7        가운뎃점 ·
U+00D7        곱셈기호 ×
U+2013-2014   – —
U+2018-2019   ‘ ’
U+201C-201D   " "
U+2022        •
U+2026        …
U+203A        ›
U+2190,2192,2194  ← → ↔
U+2302        ⌂
```

앱에 따라 특수문자가 더 필요하면(예: 체크마크 ✓, 별표 ★ 등) 이 목록에 추가해서 다시 서브셋하면 됩니다.
이모지(🚀🏠🎮 등)는 폰트에 포함할 필요 없음 — 브라우저가 시스템 이모지 폰트로 자동 대체합니다.

### 작업 절차

```bash
# 1. fontTools 설치 (woff2 압축을 위해 brotli 필요)
pip install "fonttools[woff]" brotli

# 2. Google Fonts 원본(무가공 TTF) 다운로드
curl -sS -o IBMPlexSansKR-Regular.ttf \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsanskr/IBMPlexSansKR-Regular.ttf"
curl -sS -o IBMPlexSansKR-Bold.ttf \
  "https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsanskr/IBMPlexSansKR-Bold.ttf"

# 3. 서브셋 + woff2 변환
UNICODES="U+0020-007E,U+00A0,U+AC00-D7A3,U+00B7,U+00D7,U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+2026,U+203A,U+2190,U+2192,U+2194,U+2302"

python3 -m fontTools.subset IBMPlexSansKR-Regular.ttf \
  --unicodes="$UNICODES" --flavor=woff2 \
  --output-file=IBMPlexSansKR-Regular.woff2 \
  --layout-features='*' --drop-tables+=DSIG

python3 -m fontTools.subset IBMPlexSansKR-Bold.ttf \
  --unicodes="$UNICODES" --flavor=woff2 \
  --output-file=IBMPlexSansKR-Bold.woff2 \
  --layout-features='*' --drop-tables+=DSIG
```

### 결과 용량

| 파일 | 원본 | 서브셋 후 | 절감률 |
|---|---|---|---|
| Regular (400) | ~2.8MB | **517KB** | 약 82% ↓ |
| Bold (700) | ~2.9MB | **497KB** | 약 83% ↓ |
| **합계** | ~5.7MB | **약 1MB** | |

## 3. 적용 코드 (HTML/CSS)

```html
<!-- <head> 안, 가능한 위쪽에 배치해 로딩 속도 확보 -->
<link rel="preload" href="./fonts/IBMPlexSansKR-Regular.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="./fonts/IBMPlexSansKR-Bold.woff2" as="font" type="font/woff2" crossorigin>

<style>
@font-face{
  font-family:'IBM Plex Sans KR';
  src:url('./fonts/IBMPlexSansKR-Regular.woff2') format('woff2');
  font-weight:400; font-style:normal; font-display:swap;
}
@font-face{
  font-family:'IBM Plex Sans KR';
  src:url('./fonts/IBMPlexSansKR-Bold.woff2') format('woff2');
  font-weight:700; font-style:normal; font-display:swap;
}

:root{
  --font-body:'IBM Plex Sans KR',"Malgun Gothic","맑은 고딕",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --font-head:'IBM Plex Sans KR',"Malgun Gothic","맑은 고딕",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}

body{font-family:var(--font-body);font-weight:400}

/* 제목·강조·버튼 등 굵게 쓸 요소에 개별 적용 */
h1,h2,h3,.title,.btn,button{
  font-family:var(--font-head);
  font-weight:700;
}
</style>
```

`font-display:swap`과 `<link rel="preload">`를 함께 써서, 폰트가 로딩되는 동안 대체 폰트로
먼저 보여주다가(레이아웃 밀림 최소화) 빠르게 전환되도록 합니다. 구글 폰트 CDN에 요청을
보내지 않고 저장소 안 파일을 직접 서빙하므로 외부 네트워크 지연이 없습니다.

## 4. 파일 배치

```
(저장소 루트)/
└─ fonts/
   ├─ IBMPlexSansKR-Regular.woff2   (약 517KB)
   └─ IBMPlexSansKR-Bold.woff2      (약 497KB)
```

## 5. 재사용 요청 문구 예시

> 첨부한 cnation-font1.md 참고해서 이 앱에도 같은 폰트 조합(IBM Plex Sans KR, 본문 400 /
> 제목·강조 700) 적용해줘. 폰트는 이 앱의 실제 텍스트에 맞게 새로 서브셋해서
> 최적화된 용량으로 만들고, fonts/ 폴더에 저장해줘.
