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
  }
];

/* 카테고리 표시 순서 */
const CATEGORY_ORDER = ["FONT", "CSS", "TEMPLATE", "SCRIPT", "CONFIG"];

/* 카테고리별 아이콘 */
const CATEGORY_ICON = {
  FONT: "🔤",
  CSS: "🎨",
  TEMPLATE: "🧩",
  SCRIPT: "⚙️",
  CONFIG: "🛠️"
};
