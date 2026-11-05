'use strict';
/* =========================================================
   cnation 랭킹 모듈 (온라인 + 기기) — cnation-rcp 레시피
   설명서: recipes/cnation-ranking.md
   처음 쓴 곳: cnation-bb (cnation 붕어빵 타이쿤) v1.4.1

   쓰는 법
   1) GAME 과 BOARDS 만 이 게임에 맞게 바꾼다.
   2) <script src="cnation-ranking.js"></script> 를 게임 코드보다 먼저 넣는다.
   3) 로딩이 끝난 뒤 CnationRank.preload() 를 한 번 부른다.
   4) 기록 올리기: await CnationRank.submit(board, { name, score, ... })
      랭킹 보기:  CnationRank.local(board) / await CnationRank.online(board)
   5) 화면에 이름을 넣을 때는 꼭 CnationRank.esc(name) 으로 넣는다.
   ========================================================= */
const CnationRank = (() => {
  // ── 이 게임에 맞게 바꾸는 곳 ─────────────────────────────
  const GAME = 'cnation-xxx';                 // 게임 id. 컬렉션 이름과 기기 저장 이름 앞에 붙는다
  const BOARDS = ['normal', 'hard'];          // 랭킹 판 (판마다 컬렉션 하나: cnation-xxx-rank-normal …)
  const SCORE = 'score';                      // 순위를 매길 숫자 칸 이름
  const TOP = 10;                             // 몇 위까지
  const NAME_MAX = 8;                         // 이름 최대 글자 수
  // ── cnation 공용 Firebase 프로젝트 (바꾸지 않음) ───────────
  // apiKey 는 비밀번호가 아니라 "어느 프로젝트인지" 알려 주는 공개 값이다 (Firebase 웹앱은 원래 공개됨)
  const API_KEY = 'AIzaSyCTwOAC_LrrKH8CKepUOTf0pyd9qRv4y_8';
  const DOCS = 'projects/cnation-project/databases/(default)/documents';
  const BASE = `https://firestore.googleapis.com/v1/${DOCS}`;
  const TIMEOUT = 8000;
  // ────────────────────────────────────────────────────────

  const col = (b) => `${GAME}-rank-${b}`;
  const LOCAL_KEY = (b) => `${GAME}-rank-${b}-v1`;     // 이 기기에서 낸 기록
  const CACHE_KEY = `${GAME}-online-cache-v1`;         // 마지막으로 받은 온라인 랭킹
  const NAME_KEY = `${GAME}-name`;                     // 마지막에 쓴 이름

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 공간 없음: 무시 */ } },
  };
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const byScore = (a, b) => b[SCORE] - a[SCORE];
  // 남이 쓴 기록(서버·기기 사본)은 모양부터 확인한다
  const ok = (r) => r && typeof r.name === 'string' && Number.isFinite(r[SCORE]);

  // ───────── 기기 랭킹 ─────────
  function local(board) { return ls.get(LOCAL_KEY(board), []).filter(ok); }
  function addLocal(board, entry) {
    const list = local(board).concat(entry).sort(byScore).slice(0, TOP);
    ls.set(LOCAL_KEY(board), list);
    return list.indexOf(entry);                        // 몇 등인지 (TOP 밖이면 -1)
  }

  // ───────── 온라인 랭킹 (Firestore REST, SDK 없음) ─────────
  const cache = {}, savedAt = {};
  {
    const s = ls.get(CACHE_KEY, {});
    for (const b of BOARDS) if (s[b] && Array.isArray(s[b].list)) { cache[b] = s[b].list.filter(ok).slice(0, TOP); savedAt[b] = s[b].at || 0; }
  }
  function remember(board, list) {
    cache[board] = list; savedAt[board] = Date.now();
    const s = {}; for (const b of Object.keys(cache)) s[b] = { list: cache[b], at: savedAt[b] };
    ls.set(CACHE_KEY, s);
  }
  async function call(url, body) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(`${url}?key=${API_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const enc = (v) => typeof v === 'boolean' ? { booleanValue: v } : Number.isInteger(v) ? { integerValue: String(v) } : { stringValue: String(v) };
  function dec(doc) {
    const o = { id: doc.name.split('/').pop() };
    for (const [k, f] of Object.entries(doc.fields || {})) {
      o[k] = 'integerValue' in f ? Number(f.integerValue) : 'doubleValue' in f ? Number(f.doubleValue)
        : 'booleanValue' in f ? f.booleanValue : 'stringValue' in f ? f.stringValue : undefined;
    }
    if (typeof o.name === 'string') o.name = o.name.slice(0, NAME_MAX);
    return o;
  }
  // 판별 상위 TOP 건. 실패하면 throw (화면에서는 cached() 를 보여 주면 된다)
  async function online(board) {
    const rows = await call(`${BASE}:runQuery`, { structuredQuery: {
      from: [{ collectionId: col(board) }],
      orderBy: [{ field: { fieldPath: SCORE }, direction: 'DESCENDING' }],
      limit: TOP,
    } });
    const list = rows.filter((r) => r.document).map((r) => dec(r.document)).filter(ok);
    remember(board, list);
    return list;
  }
  // 기록 한 건 추가 (문서 하나 = 기록 하나: 동시에 올려도 서로 덮지 않는다)
  async function addOnline(board, entry) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
    const fields = {};
    for (const [k, v] of Object.entries(entry)) if (v !== undefined && v !== null) fields[k] = enc(v);
    await call(`${BASE}:commit`, { writes: [{
      update: { name: `${DOCS}/${col(board)}/${id}`, fields },
      currentDocument: { exists: false },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    }] });
    remember(board, (cache[board] || []).concat({ id, ...entry }).sort(byScore).slice(0, TOP));
    return id;
  }

  // ───────── 게임에서 부르는 것 ─────────
  // 기기와 온라인에 함께 올린다. { localAt, id(온라인 성공 시), online: true|false }
  async function submit(board, data) {
    const name = String(data.name || '').trim().slice(0, NAME_MAX) || '이름 없음';
    try { localStorage.setItem(NAME_KEY, name); } catch { /* 무시 */ }
    const entry = { ...data, name, date: today() };
    const localAt = addLocal(board, entry);
    try { const id = await addOnline(board, entry); return { localAt, id, online: true }; }
    catch { return { localAt, online: false }; }
  }
  // 이 점수로 랭킹에 오를 수 있나 (기기 또는 온라인 TOP 안. 온라인 목록을 아직 모르면 true)
  function canEnter(board, score) {
    if (!(score > 0)) return false;
    const l = local(board), c = cache[board];
    const inLocal = l.length < TOP || score > l[l.length - 1][SCORE];
    const inOnline = !c || c.length < TOP || score > c[c.length - 1][SCORE];
    return inLocal || inOnline;
  }
  function preload() { BOARDS.forEach((b) => online(b).catch(() => {})); }

  return {
    BOARDS, esc, submit, canEnter, preload, local, online,
    cached: (b) => cache[b] || null,                  // 마지막으로 받은 온라인 목록 (기기에 남아 있음)
    savedAt: (b) => savedAt[b] || 0,                  // 그 목록을 받은 시각 (ms)
    lastName: () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } },
  };
})();
