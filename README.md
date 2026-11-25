# cnation-rcp

cnation 앱/게임을 만들 때 반복해서 쓰는 자료(폰트, 디자인 토큰, 템플릿 등)를 모아두는 저장소입니다.

`index.html`을 열면 카테고리별로 레시피를 훑어보고, 파일을 미리보기 / 클립보드 복사 / 다운로드할 수 있습니다.
새 앱 작업 세션에 필요한 파일을 첨부하거나 복사해서 붙여넣는 용도로 씁니다.

## 새 레시피 추가 방법

`recipe-data.js`의 `RECIPE_DATA` 배열에 항목을 추가하고, 관련 파일을 저장소에 올려두면 됩니다.
자세한 필드 설명은 `recipe-data.js` 상단 주석을 참고하세요.

## 현재 레시피

| 레시피 | 설명 |
|---|---|
| [cnation-font1.md](recipes/cnation-font1.md) | IBM Plex Sans KR 폰트 조합 (본문 400 / 제목·강조 700), 서브셋 최적화 방법 포함 |
| [cnation-ranking.md](recipes/cnation-ranking.md) | 랭킹 기능: Firebase `cnation-project`에 컬렉션만 추가, 온라인 + 기기 동시 저장, 인터넷이 안 될 때도 마지막 목록 표시. 모듈 [cnation-ranking.js](recipes/cnation-ranking.js) 포함 |
| [cnation-api-key.md](recipes/cnation-api-key.md) | Gemini·GitHub Models·Groq(+Tavily 검색) AI 질문/답변 기능 붙이는 가이드. 키 값은 포함하지 않음 |
| [cnation-equalizer.md](recipes/cnation-equalizer.md) | 이퀄라이저(오디오 비주얼라이저): 곡을 미리 FFT 분석해 재생 위치에 맞춰 그림. iOS 백그라운드 재생 유지, 디자인 A~F, React/바닐라 JS 예시 포함 |
