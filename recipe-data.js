/* =========================================================
   cnation-rcp - RECIPE DATA

   [새 레시피 추가 방법]
   아래 RECIPE_DATA 배열 안에 항목 하나를 추가하면 됩니다.

   필수 항목
   - id       : 고유 id (영문/숫자/하이픈)
   - title    : 레시피 이름
   - category : 카테고리 (FONT / CSS / TEMPLATE / SCRIPT / CONFIG 등)
   - desc     : 간단한 설명
   - files    : 이 레시피에 포함된 파일 목록
                { name: 파일명, path: 저장소 내 경로, type: 'text'|'binary' }
                type이 'text'이면 미리보기 + 클립보드 복사가 가능하고,
                'binary'이면 다운로드만 제공됩니다.
   ========================================================= */

const RECIPE_DATA = [
  {
    id: "font1",
    title: "cnation 폰트 조합 #1 — IBM Plex Sans KR",
    category: "FONT",
    icon: "🔤",
    desc: "본문 Regular(400) / 제목·강조 Bold(700), 한글 전체 음절 서브셋 woff2 (약 1MB)",
    files: [
      { name: "cnation-font1.md", path: "recipes/cnation-font1.md", type: "text" },
      { name: "IBMPlexSansKR-Regular.woff2", path: "fonts/IBMPlexSansKR-Regular.woff2", type: "binary" },
      { name: "IBMPlexSansKR-Bold.woff2", path: "fonts/IBMPlexSansKR-Bold.woff2", type: "binary" }
    ]
  },

  {
    id: "api-key",
    title: "cnation API 키 설정 가이드",
    category: "API",
    icon: "🤖",
    desc: "Gemini·GitHub Models·Groq(+Tavily 검색)로 AI 질문/답변 기능을 붙이는 가이드. API 키는 Vercel 팀 Shared 환경변수로 이미 등록됨",
    files: [
      { name: "cnation-api-key.md", path: "recipes/cnation-api-key.md", type: "text" }
    ]
  },

  {
    id: "ranking",
    title: "cnation 랭킹 기능 — 온라인 + 기기 동시 저장",
    category: "SCRIPT",
    icon: "🏆",
    desc: "Firebase cnation-project에 컬렉션만 추가해서 쓰는 랭킹. 기록 한 건씩 추가, SDK 없이 REST, 인터넷이 안 되면 기기에 남은 목록을 보여 줌 (cnation-bb에서 사용)",
    files: [
      { name: "cnation-ranking.md", path: "recipes/cnation-ranking.md", type: "text" },
      { name: "cnation-ranking.js", path: "recipes/cnation-ranking.js", type: "text" }
    ]
  },

  {
    id: "equalizer",
    title: "cnation 이퀄라이저 — 미리 분석 방식",
    category: "SCRIPT",
    icon: "🎚️",
    desc: "음악 파일을 미리 FFT 분석해 audio.currentTime에 맞춰 그리는 비주얼라이저. iPhone 잠금화면·백그라운드 재생 유지, 6가지 디자인(A~F), React/바닐라 JS 예시 포함 (cnation-mb에서 사용)",
    files: [
      { name: "cnation-equalizer.md", path: "recipes/cnation-equalizer.md", type: "text" }
    ]
  }
];

/* 카테고리 표시 순서 */
const CATEGORY_ORDER = ["FONT", "CSS", "TEMPLATE", "SCRIPT", "CONFIG", "API"];

/* 카테고리별 아이콘 */
const CATEGORY_ICON = {
  FONT: "🔤",
  CSS: "🎨",
  TEMPLATE: "🧩",
  SCRIPT: "⚙️",
  CONFIG: "🛠️",
  API: "🤖"
};
