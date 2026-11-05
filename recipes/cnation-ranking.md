# cnation 랭킹 기능 — 온라인 + 기기 동시 저장

cnation 게임에 **랭킹**을 넣을 때 쓰는 방법입니다. `cnation-bb`(cnation 붕어빵 타이쿤) v1.4.1에서 실제로 만들고 확인한 방식을 정리했습니다.
새 게임에 넣을 때는 이 문서와 `cnation-ranking.js`를 첨부하고 "이 방식으로 랭킹 넣어줘"라고 요청하면 됩니다.

## 0. 한눈에 보기

| 항목 | 내용 |
|---|---|
| 서버 | Firebase **cnation-project** 공용 프로젝트의 Firestore. 게임마다 **컬렉션만 추가**합니다 |
| 컬렉션 이름 | `cnation-<게임id>-rank-<판>` (예: `cnation-bb-rank-bean`). 판(난이도·모드)마다 하나씩 |
| 저장 단위 | **기록 한 건 = 문서 하나**. 상위 10명을 배열 하나에 덮어쓰지 않습니다 |
| 연결 방법 | Firebase SDK 없이 **Firestore REST API**를 `fetch`로 부릅니다 (빌드 없는 정적 게임에 맞음) |
| 기기 저장 | 내가 낸 기록과 마지막으로 받은 온라인 랭킹을 `localStorage`에 남깁니다 |
| 화면 | 판 탭 + **🌏 전체 / 📱 내 기기** 토글 |
| Firebase 콘솔 작업 | **없음**. 지금 프로젝트 규칙이 모든 컬렉션을 열어 두어서, 첫 기록이 올라갈 때 컬렉션이 자동으로 생깁니다 |

## 1. 왜 이렇게 하나 (cnation-jgame 방식과 비교)

| | 예전 (cnation-jgame) | 이 방식 |
|---|---|---|
| 저장 구조 | 판마다 문서 하나에 상위 10명 배열을 **덮어씀** | 기록마다 문서 하나를 **추가만** 함 |
| 둘이 동시에 올리면 | 한 사람 기록이 사라질 수 있음 | 둘 다 남음 |
| 인터넷이 안 될 때 | 랭킹이 빈 화면 | 마지막으로 받은 목록 + "언제 받은 목록인지" 안내, 📱 내 기기 기록은 항상 보임 |
| 올리기 실패 | 기록이 사라짐 | 기기에는 남음 |
| 이름 표시 | `innerHTML`에 그대로 넣음 → 이름에 넣은 코드가 **다른 사람 화면에서 실행**될 수 있음 | `esc()`로 글자로만 넣음 |
| 첫 로딩 | Firebase SDK(수백 KB)를 받음 | SDK 없음. 랭킹은 로딩이 끝난 뒤 뒤에서 받음 |
| 관리자 초기화 | 화면에서 비밀번호(코드에 그대로 보임) | 화면 기능 없음. Firebase 콘솔 [데이터] 탭에서 지움 |

## 2. 파일

- `cnation-ranking.js`: 바로 쓰는 모듈입니다. 맨 위 **바꾸는 곳**만 고칩니다.

```js
const GAME = 'cnation-xxx';          // 게임 id → 컬렉션 cnation-xxx-rank-<판>
const BOARDS = ['normal', 'hard'];   // 랭킹 판
const SCORE = 'score';               // 순위를 매길 숫자 칸 (붕어빵은 money)
const TOP = 10;                      // 몇 위까지
const NAME_MAX = 8;                  // 이름 최대 글자 수
```

Firebase 설정값(`apiKey`, 프로젝트 id)은 cnation 공용이라 그대로 둡니다.
`apiKey`는 비밀번호가 아니고 "어느 프로젝트인지" 알려 주는 공개 값입니다. Firebase 웹앱은 원래 이 값이 공개됩니다.
그래서 [API 키 가이드](cnation-api-key.md)의 "키 값은 적지 않는다" 규칙과는 다릅니다.

## 3. 게임에 붙이기

```html
<script src="cnation-ranking.js"></script>   <!-- 게임 코드보다 먼저 -->
<script src="game.js"></script>
```

```js
// ① 로딩 화면이 끝난 뒤 한 번 (첫 로딩을 늦추지 않게)
CnationRank.preload();

// ② 게임이 끝났을 때: 랭킹에 오를 수 있으면 이름 입력칸을 보여 준다
if (CnationRank.canEnter('normal', score)) {
  nameInput.value = CnationRank.lastName();   // 지난번 이름을 미리 채움
  showNameEntry();
}

// ③ [랭킹에 올리기] 버튼
const r = await CnationRank.submit('normal', { name: nameInput.value, score, level: 3 });
if (r.online) showRanking('normal', 'online', { id: r.id });            // 전체 랭킹에서 내 기록 강조
else showRanking('normal', 'local', { at: r.localAt },
                 '전체 랭킹에 올리지 못했어요. 이 기기에는 저장했어요.');
```

### 랭킹 화면 그리기

```js
async function showRanking(board, scope = 'online', me = {}, note = '') {
  setNote(note);
  if (scope === 'local') return draw(CnationRank.local(board), (r, i) => i === me.at);
  const cached = CnationRank.cached(board);            // 기기에 남아 있는 마지막 온라인 목록
  if (cached) draw(cached, (r) => r.id === me.id);      // 먼저 바로 보여 주고
  else listEl.innerHTML = '<p>전체 랭킹을 불러오는 중…</p>';
  try {
    draw(await CnationRank.online(board), (r) => r.id === me.id);   // 새로 받으면 바꿔 그림
  } catch {
    if (cached) {
      const t = new Date(CnationRank.savedAt(board));
      setNote(note || `인터넷 연결이 안 돼서 마지막으로 받은 목록이에요 (${t.getMonth() + 1}/${t.getDate()} ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')})`);
    } else listEl.innerHTML = '<p>전체 랭킹을 불러오지 못했어요. 📱 내 기기 기록은 볼 수 있어요.</p>';
  }
}
function draw(list, isMe) {
  listEl.innerHTML = list.length ? list.map((r, i) => `
    <div class="rank-row ${isMe(r, i) ? 'me' : ''}">
      <span>${i + 1}</span><span>${CnationRank.esc(r.name)}</span><b>${r.score.toLocaleString()}</b>
    </div>`).join('') : '<p>아직 기록이 없어요.</p>';
}
```

- 이름처럼 **남이 쓴 글자**는 반드시 `CnationRank.esc()`를 거쳐서 넣습니다. 숫자는 그대로 써도 됩니다.
- 두 번 그리는 이유: 받아 둔 목록을 먼저 보여 주면 화면이 바로 뜨고, 새 목록이 오면 조용히 바뀝니다.
- 여러 번 빠르게 탭을 바꾸면 늦게 온 응답이 다른 판 화면을 덮을 수 있습니다. `cnation-bb`처럼 요청마다 번호(token)를 붙이고 마지막 요청만 그리면 안전합니다.

## 4. 기기에 남는 것 (localStorage)

| 키 | 내용 |
|---|---|
| `cnation-xxx-rank-<판>-v1` | 이 기기에서 낸 기록 상위 10건 |
| `cnation-xxx-online-cache-v1` | 판마다 마지막으로 받은 온라인 랭킹과 받은 시각 |
| `cnation-xxx-name` | 마지막에 쓴 이름 |

- 사파리 방문 기록·웹사이트 데이터를 지우면 함께 지워집니다. 홈 화면에 추가해서 쓰면 덜 지워집니다.
- 저장 공간이 없거나 사파리 개인정보 보호 모드여도 오류 없이 동작합니다. 모든 읽기·쓰기를 `try`로 감쌌습니다.

## 5. 보안 수준 (가족·지인용 기준)

- 지금 `cnation-project` 규칙은 `match /{document=**} { allow read, write: if true; }`로 **모든 컬렉션이 열려** 있습니다. 그래서 콘솔 작업 없이 컬렉션만 추가하면 됩니다.
- 이 상태에서 마음먹은 사람은 개발자 도구로 가짜 기록을 넣거나 지울 수 있습니다. 가족·지인끼리 쓰는 게임에서는 괜찮다고 보고 이대로 씁니다(2026-11-05 결정).
- 대신 게임 코드에서 두 가지는 꼭 지킵니다.
  - 이름은 `esc()`로 글자로만 표시합니다. 이름에 넣은 코드가 실행되지 않게 합니다.
  - 기록은 한 건씩 추가합니다. 덮어쓰기를 하지 않습니다.
- 이상한 기록은 Firebase 콘솔 → Firestore → [데이터] → 해당 컬렉션에서 지웁니다.
- 나중에 공개 게임이 되면, 판별로 "추가만 가능 + 값 범위 검사" 규칙을 넣습니다. 예시는 `cnation-bb/docs/firestore.rules`에 있습니다.
  - 단, 모든 컬렉션을 여는 위 한 줄이 남아 있으면 이 규칙은 효과가 없습니다. 그 줄을 정리하려면 같은 프로젝트를 쓰는 다른 앱의 컬렉션을 하나씩 적어 줘야 합니다.

## 6. 테스트할 때 주의

- 자동 테스트(Playwright 등)에서는 Firestore 요청을 **가짜로 바꿔서** 실제 랭킹에 시험 기록이 올라가지 않게 합니다.

```js
await page.route('https://firestore.googleapis.com/**', (r) => {
  const u = r.request().url();
  if (u.includes(':commit')) return r.fulfill({ contentType: 'application/json', body: '{}' });
  return r.fulfill({ contentType: 'application/json', body: '[{"readTime":"x"}]' });   // 빈 랭킹
});
// 인터넷이 끊긴 상황: r.abort()
```

- 확인할 흐름:
  - 올리기 성공 → 전체 랭킹에서 내 기록 강조
  - 올리기 실패 → 기기에 저장되고 안내가 뜸
  - 받아 둔 뒤 인터넷을 끊고 새로 켬 → 예전 목록과 받은 시각이 보임
  - 이름에 `<img src=x onerror=alert(1)>`를 넣어도 글자로만 보임
- 실제 서버에서 한 번 확인하려면, 시험 기록을 올린 뒤 바로 지웁니다(REST `DELETE`나 콘솔).

## 7. 비용

Firestore 무료 한도는 하루 읽기 5만 건, 쓰기 2만 건입니다.
- 랭킹을 한 번 열 때: 판 하나당 읽기 10건
- 기록을 한 번 올릴 때: 쓰기 1건

가족·지인 규모에서는 무료 한도의 1%도 쓰지 않습니다.
