# 웹 이퀄라이저(오디오 비주얼라이저) 제작 가이드 — "미리 분석" 방식

> cnation-mb v1.8.0에서 실제로 쓰는 방식을 정리한 문서입니다. 다른 웹앱·PWA에 그대로 옮겨 쓸 수 있도록
> 분석 파이프라인, 재생 동기화, 6가지 디자인(A~F)의 그리기 코드, React/바닐라 JS 연동 예시를 모두 담았습니다.
>
> - 실제 구현: `src/audio/spectrum.ts`, `src/audio/spectrum.worker.ts`, `src/components/Equalizer.tsx`
> - 6가지 시안 미리보기: https://claude.ai/artifact/8xMqgrhQjieYMCQwojZvCo

---

## 목차

1. [왜 "미리 분석" 방식인가](#1-왜-미리-분석-방식인가)
2. [전체 구조](#2-전체-구조)
3. [1단계 — 곡 분석 (디코딩 → FFT → 밴드)](#3-1단계--곡-분석)
4. [2단계 — 재생 위치에 맞춰 값 꺼내기](#4-2단계--재생-위치에-맞춰-값-꺼내기)
5. [3단계 — 그리기 루프 (부드러움 · 배터리)](#5-3단계--그리기-루프)
6. [6가지 디자인 A~F](#6-6가지-디자인)
7. [연동 예시 (React / 바닐라 JS)](#7-연동-예시)
8. [성능 · 메모리 수치](#8-성능--메모리)
9. [iOS·Safari 주의사항](#9-iossafari-주의사항)
10. [튜닝 가이드 (파라미터 표)](#10-튜닝-가이드)
11. [테스트 방법](#11-테스트-방법)
12. [문제 해결 FAQ](#12-문제-해결-faq)

---

## 1. 왜 "미리 분석" 방식인가

| 방식 | 음악과 맞나? | 배터리·성능 | 문제점 |
|---|---|---|---|
| ① **실시간 분석** (`createMediaElementSource` → `AnalyserNode`) | ✅ 정확 | 보통 | ❌ **iPhone에서 화면이 꺼지거나 잠기면 소리가 멈춤.** 소리가 Web Audio를 거치는데, iOS가 백그라운드에서 AudioContext를 정지시키기 때문. 무음 스위치 영향도 받음 |
| ② **미리 분석** (이 문서) | ✅ 거의 정확 (46ms 단위) | 낮음 | 곡 시작 시 0.5~1초 분석 (눈에 거의 안 띔) |
| ③ 장식용 애니메이션 | ❌ 음악과 무관 | 거의 0 | 진짜 반응이 아님 |

**② 방식의 핵심 아이디어**

- 소리는 평범한 `<audio>` 요소가 그대로 재생한다. iOS 백그라운드·잠금화면 재생, 잠금화면 컨트롤, 무음 스위치 무시가 모두 유지된다.
- 화면 표시는 **같은 파일을 따로 한 번 분석**해 둔 "시간별 막대 높이 표"를 `audio.currentTime`으로 찾아서 그린다.
- 소리 경로와 그림 경로가 완전히 분리되어 있어서, 그림 쪽에 문제가 생겨도 음악은 절대 끊기지 않는다.

---

## 2. 전체 구조

```
[음악 파일 Blob/URL]
      │
      ├──────────────► <audio src=url>  ──► 스피커 (재생은 여기서만)
      │                       │
      │                       └─ currentTime (초) ──────────┐
      ▼                                                      │
 ① fetch → ArrayBuffer                                       │
 ② OfflineAudioContext(1ch, 11025Hz).decodeAudioData         │
    → 저음질 모노 PCM (메인 스레드: Safari 워커엔 OAC 없음)     │
 ③ Worker: 프레임마다 Hann 창 → FFT(512) → 로그 28밴드 → dB   │
    → 곡 전체 기준 자동 스케일 → Uint8Array(frames × bands)    │
      │                                                      │
      ▼                                                      ▼
   Spectrum { data, frames, frameSec } ──► bandsAt(spec, t) → 0~1 값 28개
                                                             │
                                        requestAnimationFrame │ (보일 때 + 재생 중일 때만)
                                                             ▼
                                      부드럽게(attack/release) → Canvas에 그리기 (A~F)
```

---

## 3. 1단계 — 곡 분석

### 3-1. 기본 파라미터

```ts
export const EQ_BANDS = 28;     // 막대 개수 (분석 밴드 수). 디자인마다 다시 묶어 쓸 수 있음 (6-0 참고)
const SR = 11025;               // 분석용 샘플레이트 — 표시엔 5kHz까지면 충분, 메모리 1/4
const FFT = 512;                // FFT 크기 → 주파수 해상도 11025/512 ≈ 21.5Hz
const HOP = 512;                // 프레임 간격 → 512/11025 ≈ 46ms (초당 약 21.5프레임, 화면에선 보간)
const MAX_BYTES = 80 * 1024 * 1024; // 이보다 큰 파일은 분석 생략 (폰 메모리 보호)
```

### 3-2. 저음질 디코딩 (메인 스레드)

`OfflineAudioContext`에 원하는 샘플레이트를 주고 `decodeAudioData`하면 **브라우저가 알아서 리샘플**해 준다.
iOS Safari의 Web Worker에는 `OfflineAudioContext`가 없으므로 디코딩은 메인 스레드에서 한다. 비동기라 화면이 멈추지는 않는다.

```ts
function decodeLowRate(buf: ArrayBuffer): Promise<AudioBuffer> {
  const OAC: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const ctx = new OAC(1, 1, SR); // 채널 1, 길이 1(사용 안 함), 샘플레이트 11025
  return new Promise((resolve, reject) => {
    // 구형 Safari는 콜백 방식만 지원 → 콜백 + Promise 둘 다 처리
    const p = ctx.decodeAudioData(buf, resolve, reject);
    if (p && typeof (p as Promise<AudioBuffer>).catch === 'function') (p as Promise<AudioBuffer>).catch(reject);
  });
}

function toMono(ab: AudioBuffer): Float32Array {
  if (ab.numberOfChannels === 1) return new Float32Array(ab.getChannelData(0));
  const m = new Float32Array(ab.length);
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < d.length; i++) m[i] += d[i] / ab.numberOfChannels;
  }
  return m;
}
```

### 3-3. 워커: FFT → 로그 밴드 → dB → 자동 스케일

`spectrum.worker.ts` 전체 코드입니다. 외부 라이브러리 없이 radix-2 FFT를 씁니다.

```ts
/// <reference lib="webworker" />
interface Req { samples: Float32Array; sampleRate: number; bands: number; fftSize: number; hop: number; }

// 제자리(in-place) radix-2 FFT. n은 2의 거듭제곱
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {          // 비트 반전 정렬
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {       // 버터플라이
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

self.onmessage = (e: MessageEvent<Req>) => {
  try {
    const { samples, sampleRate, bands, fftSize, hop } = e.data;
    const frames = Math.max(1, Math.floor((samples.length - fftSize) / hop) + 1);
    const half = fftSize / 2, binHz = sampleRate / fftSize;

    // ① 로그 간격 밴드 경계 (50Hz ~ min(나이퀴스트×0.9, 5kHz)) — 사람 귀는 로그로 들음
    const fLo = 50, fHi = Math.min(sampleRate * 0.45, 5000);
    const edges: number[] = [];
    for (let b = 0; b <= bands; b++) edges.push(fLo * Math.pow(fHi / fLo, b / bands));
    const lo = new Int32Array(bands), hi = new Int32Array(bands);
    for (let b = 0; b < bands; b++) {
      lo[b] = Math.max(1, Math.floor(edges[b] / binHz));
      hi[b] = Math.min(half - 1, Math.max(lo[b], Math.ceil(edges[b + 1] / binHz) - 1)); // 최소 1개 bin 보장
    }

    // ② Hann 창 (프레임 경계의 잡음 줄이기)
    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));

    // ③ 프레임마다 FFT → 밴드 평균 파워 → dB (+고음 기울기 보정)
    const db = new Float32Array(frames * bands);
    const re = new Float32Array(fftSize), im = new Float32Array(fftSize);
    for (let f = 0; f < frames; f++) {
      const off = f * hop;
      for (let i = 0; i < fftSize; i++) { re[i] = (samples[off + i] ?? 0) * win[i]; im[i] = 0; }
      fft(re, im);
      for (let b = 0; b < bands; b++) {
        let p = 0;
        for (let k = lo[b]; k <= hi[b]; k++) p += re[k] * re[k] + im[k] * im[k];
        p /= hi[b] - lo[b] + 1;
        // 음악은 고음 에너지가 작아 오른쪽 막대가 죽어 보임 → 오른쪽으로 갈수록 +0~9dB
        db[f * bands + b] = 10 * Math.log10(p + 1e-12) + (b / (bands - 1)) * 9;
      }
    }

    // ④ 곡 전체 기준 자동 스케일: 상위 2%를 꼭대기로, 그 아래 45dB를 0~1로
    //    (조용한 곡·큰 곡 모두 화면을 적당히 채움)
    const sorted = Float32Array.from(db).sort();
    const top = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
    const floor = top - 45;
    const out = new Uint8Array(frames * bands);          // 0~255로 양자화 → 메모리 1/4
    for (let i = 0; i < out.length; i++) {
      const v = (db[i] - floor) / (top - floor);
      out[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }
    (self as any).postMessage({ ok: true, data: out, frames, frameSec: hop / sampleRate }, [out.buffer]);
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
```

### 3-4. 분석 진입점 + 캐시

```ts
export interface Spectrum { data: Uint8Array; frames: number; frameSec: number; }

const cache = new Map<string, Spectrum>();                 // 최근 6곡 LRU
const inflight = new Map<string, Promise<Spectrum | null>>(); // 같은 곡 동시 분석 방지

function runWorker(samples: Float32Array): Promise<Spectrum> {
  // Vite/webpack 5: new URL('./spectrum.worker.ts', import.meta.url)로 번들됨
  const w = new Worker(new URL('./spectrum.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    w.onmessage = (e) => { w.terminate(); e.data.ok ? resolve(e.data) : reject(new Error(e.data.error)); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || '분석 실패')); };
    // samples.buffer를 transfer → 복사 없이 넘김 (메인 스레드 메모리 즉시 해제)
    w.postMessage({ samples, sampleRate: SR, bands: EQ_BANDS, fftSize: FFT, hop: HOP }, [samples.buffer]);
  });
}

/** 같은 곡은 캐시. 실패하거나 너무 크면 null → 막대만 낮게 유지(재생엔 영향 없음) */
export function analyzeTrack(id: string, url: string, size: number): Promise<Spectrum | null> {
  const hit = cache.get(id);
  if (hit) { cache.delete(id); cache.set(id, hit); return Promise.resolve(hit); }
  const running = inflight.get(id);
  if (running) return running;
  if (size > MAX_BYTES) return Promise.resolve(null);
  const p = (async () => {
    try {
      const buf = await (await fetch(url)).arrayBuffer(); // blob: URL도 fetch 가능
      const mono = toMono(await decodeLowRate(buf));
      const spec = await runWorker(mono);
      cache.set(id, spec);
      while (cache.size > 6) cache.delete(cache.keys().next().value as string);
      return spec;
    } catch { return null; } finally { inflight.delete(id); }
  })();
  inflight.set(id, p);
  return p;
}
```

> **다른 앱에서 쓸 때:** `id`는 곡을 구분하는 아무 문자열(파일 해시·DB 키·URL)이면 됩니다.
> 분석 결과(`Uint8Array`)를 IndexedDB에 같이 저장해 두면 앱을 다시 열어도 재분석이 필요 없습니다.

---

## 4. 2단계 — 재생 위치에 맞춰 값 꺼내기

분석 프레임은 46ms 간격이고 화면은 60fps(16ms)라서, **두 프레임 사이를 선형 보간**해야 끊김 없이 움직입니다.

```ts
/** 재생 시각 t(초)의 막대 높이 0~1을 out에 채움 */
export function bandsAt(spec: Spectrum, t: number, out: Float32Array) {
  const x = t / spec.frameSec;
  const f0 = Math.max(0, Math.min(spec.frames - 1, Math.floor(x)));
  const f1 = Math.min(spec.frames - 1, f0 + 1);
  const k = Math.max(0, Math.min(1, x - f0));
  const n = out.length;
  for (let b = 0; b < n; b++) {
    const a = spec.data[f0 * n + b], c = spec.data[f1 * n + b];
    out[b] = (a + (c - a) * k) / 255;
  }
}
```

- `t`는 상태(state)로 관리하는 시간보다 **`audio.currentTime`을 매 프레임 직접 읽는 것**이 정확합니다. `timeupdate` 이벤트는 250ms마다라 너무 거칩니다.
- 표시 지연을 맞추고 싶으면 `t + 0.03`처럼 30ms 정도 앞당겨 읽어도 됩니다. 스피커 지연 보정용입니다.

---

## 5. 3단계 — 그리기 루프

### 5-1. 부드러움: attack(빠르게 오름) / release(천천히 내림)

```ts
const level = new Float32Array(N).fill(0.03); // 화면에 보이는 현재 높이
const target = new Float32Array(N);           // 이번 프레임 목표값 (bandsAt 결과)

for (let i = 0; i < N; i++) {
  const d = target[i] - level[i];
  level[i] += d * (d > 0 ? 0.55 : 0.18);       // 올라갈 땐 55%, 내려갈 땐 18%씩 따라감
}
```

- attack이 크면 → 북소리에 즉각 반응 (펀치감)
- release가 작으면 → 막대가 천천히 내려와 출렁이는 느낌. 너무 작으면 둔해 보임
- 일시정지 시 target을 `0.03`(바닥)으로 → 자연스럽게 가라앉음

### 5-2. 배터리: "보일 때 + 재생 중일 때만" 그리기

```ts
let raf = 0;
function draw(now: number) {
  raf = 0;
  if (document.hidden) return;                       // 화면 꺼짐/다른 앱 → 즉시 중단
  const playing = !audio.paused;
  if (playing && spec) bandsAt(spec, audio.currentTime, target);
  else target.fill(playing ? 0.06 : 0.03);           // 분석 전(재생 중) / 일시정지
  let moving = false;
  for (let i = 0; i < N; i++) {
    const d = target[i] - level[i];
    level[i] += d * (d > 0 ? 0.55 : 0.18);
    if (Math.abs(d) > 0.004) moving = true;
  }
  render(ctx, w, h, level);                           // ← 디자인 A~F 중 하나
  if (playing || moving) raf = requestAnimationFrame(draw); // 다 가라앉으면 루프 정지
}
const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(draw); };
audio.addEventListener('play', kick);
audio.addEventListener('pause', kick);               // 가라앉는 애니메이션을 위해
document.addEventListener('visibilitychange', kick);
```

### 5-3. 선명한 캔버스 (레티나)

```ts
function resize(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const dpr = Math.min(2, window.devicePixelRatio || 1); // 3배까지는 불필요(배터리)
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);                // 이후 그리기는 CSS 픽셀 단위
  return { w: r.width, h: r.height };
}
new ResizeObserver(() => ({ w, h } = resize(canvas, ctx))).observe(canvas);
```

### 5-4. 접근성: 동작 줄이기

```ts
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
// reduce면 100ms(10fps) 간격으로만 갱신
if (reduce && now - last < 100) { raf = requestAnimationFrame(draw); return; }
```

---

## 6. 6가지 디자인

### 6-0. 공통 준비물

모든 그리기 함수는 **같은 형식**이다: `(ctx, w, h, v: Float32Array /*0~1*/) => void`.
분석은 한 번만 하고(예: 28밴드 또는 48밴드), 디자인마다 막대 수가 다르면 아래 `regroup`으로 다시 묶는다.

```ts
// N개 밴드 → n개로 다시 묶기 (평균)
function regroup(src: Float32Array, n: number): Float32Array {
  if (src.length === n) return src;
  const out = new Float32Array(n), N = src.length;
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * N), b = Math.max(a + 1, Math.floor(((i + 1) / n) * N));
    let s = 0; for (let j = a; j < b; j++) s += src[Math.min(j, N - 1)];
    out[i] = s / (b - a);
  }
  return out;
}

// 색 (cnation 앱 팔레트 — 바꿔 쓰세요)
const C = { a: '#7c5cff' /*보라*/, b: '#22d3ee' /*하늘*/, pink: '#f472b6', line: '#2a3142' /*꺼진 점*/ };

// 아래→위 세로 그라데이션
function vGrad(ctx: CanvasRenderingContext2D, h: number) {
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, C.a); g.addColorStop(1, C.b);
  return g;
}

// 둥근 사각형 (구형 Safari는 roundRect가 없어 rect로 대체)
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  ctx.fill();
}
```

> 분석 밴드 수 권장: 디자인이 하나로 정해졌으면 **그 막대 수와 같게**(A=28) 분석합니다. 여러 디자인을 바꿔 가며 쓸 앱이면 **48밴드로 분석**하고 `regroup`으로 줄여 씁니다. 늘리는 건 정보가 없어 계단처럼 보입니다.

---

### A. 클래식 막대 ✅ (cnation-mb 채택)

아래에서 올라오는 둥근 막대 28개. 가장 익숙하고 깔끔합니다. 높이 56~72px에 어울립니다.

```ts
function drawBars(ctx: CanvasRenderingContext2D, w: number, h: number, v0: Float32Array) {
  const n = 28, v = regroup(v0, n);
  const gap = w * 0.012;                       // 막대 사이 간격 = 폭의 1.2%
  const bw = (w - gap * (n - 1)) / n;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = vGrad(ctx, h);
  for (let i = 0; i < n; i++) {
    const bh = Math.max(3, v[i] * h);          // 최소 3px → 조용해도 막대 줄이 보임
    rr(ctx, i * (bw + gap), h - bh, bw, bh, bw / 2);
  }
}
```

| 조절 | 값 | 효과 |
|---|---|---|
| `n` | 20~40 | 적을수록 굵고 시원, 많을수록 촘촘 |
| `gap` | 폭의 0.8~2% | 클수록 막대가 또렷이 분리 |
| 반지름 | `bw/2` → `2` | 캡슐형 → 각진 막대 |

---

### B. 미러 막대

가운데 선을 기준으로 위아래 대칭. 파형처럼 보여서 차분하고 고급스럽습니다. 색은 **가로** 그라데이션(저음 보라 → 고음 하늘)입니다.

```ts
function drawMirror(ctx: CanvasRenderingContext2D, w: number, h: number, v0: Float32Array) {
  const n = 32, v = regroup(v0, n);
  const gap = w * 0.01, bw = (w - gap * (n - 1)) / n, mid = h / 2;
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, C.a); g.addColorStop(1, C.b);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = g;
  for (let i = 0; i < n; i++) {
    const bh = Math.max(2, v[i] * h * 0.95);
    rr(ctx, i * (bw + gap), mid - bh / 2, bw, bh, bw / 2);
  }
}
```

- 변형: 아래쪽 절반만 `globalAlpha = 0.35`로 그리면 "물에 비친" 반사 효과가 납니다.

---

### C. 피크 홀드

막대 위에 작은 캡이 떠 있다가 천천히 떨어집니다. 오디오 장비 같은 생동감이 있습니다. 캡 위치를 프레임마다 기억해야 하므로 **상태(peaks)가 필요**합니다.

```ts
const PN = 28;
const peaks = new Float32Array(PN);   // 캡 높이 0~1
const peakVel = new Float32Array(PN); // 캡 낙하 속도 (중력처럼 가속)

function drawPeak(ctx: CanvasRenderingContext2D, w: number, h: number, v0: Float32Array) {
  const n = PN, v = regroup(v0, n);
  const gap = w * 0.012, bw = (w - gap * (n - 1)) / n, cap = 3, room = 8; // 위쪽 8px은 캡 자리
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = vGrad(ctx, h);
  for (let i = 0; i < n; i++) {
    const bh = Math.max(3, v[i] * (h - room));
    rr(ctx, i * (bw + gap), h - bh, bw, bh, 2);
    if (v[i] > peaks[i]) { peaks[i] = v[i]; peakVel[i] = 0; }            // 막대가 밀어 올림
    else { peakVel[i] += 0.0009; peaks[i] = Math.max(0, peaks[i] - peakVel[i]); } // 가속 낙하
  }
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < n; i++) {
    const y = h - Math.max(3, peaks[i] * (h - room)) - cap - 2;
    rr(ctx, i * (bw + gap), y, bw, cap, 1);
  }
}
```

| 조절 | 값 | 효과 |
|---|---|---|
| 중력 `0.0009` | 0.0005~0.002 | 작을수록 캡이 오래 떠 있음 |
| 캡 색 | 흰색 / 하늘 / 핑크 | 흰색이 가장 또렷 |
| 일정 시간 정지 | 떨어지기 전 300ms 멈춤 추가 가능 | 클래식 하이파이 느낌 |

> 곡이 바뀔 때 `peaks.fill(0)`으로 초기화하세요.

---

### D. LED 도트

점이 층층이 켜지는 하이파이 스타일입니다. 높이에 따라 색이 바뀝니다(하늘 → 보라 → 핑크). 꺼진 점도 희미하게 보여서 격자감이 납니다.

```ts
function drawDots(ctx: CanvasRenderingContext2D, w: number, h: number, v0: Float32Array) {
  const n = 22, rows = 10, v = regroup(v0, n);
  const gx = w / n, gy = h / rows, r = Math.min(gx, gy) * 0.32; // 점 반지름 = 칸의 32%
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const lit = Math.max(1, Math.round(v[i] * rows));            // 최소 1칸은 켜짐
    for (let j = 0; j < rows; j++) {
      const on = j < lit;
      ctx.fillStyle = on ? (j >= rows * 0.8 ? C.pink : j >= rows * 0.5 ? C.a : C.b) : C.line;
      ctx.globalAlpha = on ? 1 : 0.55;
      ctx.beginPath();
      ctx.arc(gx * (i + 0.5), h - gy * (j + 0.5), r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
```

- 정사각형 LED를 원하면 `arc` 대신 `rr(ctx, x - r, y - r, 2r, 2r, 2)`로 바꿉니다.
- 칸 수가 많을수록(22×10 = 220개) 그리기 비용이 커집니다. 300개 이하를 권장합니다.

---

### E. 스무스 웨이브

막대 대신 부드러운 곡선과 그라데이션 면을 씁니다. 가장 부드럽고 몽환적입니다. 베지어 곡선으로 밴드 사이를 잇습니다.

```ts
function drawWave(ctx: CanvasRenderingContext2D, w: number, h: number, v0: Float32Array) {
  const n = 24, v = regroup(v0, n);
  const pts = Array.from({ length: n }, (_, i) => [(i / (n - 1)) * w, h - Math.max(2, v[i] * h * 0.92)]);
  const path = () => {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], mx = (x0 + x1) / 2;
      ctx.bezierCurveTo(mx, y0, mx, y1, x1, y1);              // 중간점 제어 → 부드러운 S자
    }
  };
  ctx.clearRect(0, 0, w, h);
  // 면: 위쪽 하늘색(67%) → 아래 보라(6%)
  const fill = ctx.createLinearGradient(0, 0, 0, h);
  fill.addColorStop(0, C.b + 'aa'); fill.addColorStop(1, C.a + '10');
  ctx.beginPath(); path(); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  // 윤곽선: 가로 그라데이션
  const stroke = ctx.createLinearGradient(0, 0, w, 0);
  stroke.addColorStop(0, C.a); stroke.addColorStop(1, C.b);
  ctx.beginPath(); path();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
}
```

- 점 수 `n`이 적을수록(16~24) 더 부드럽고, 많을수록(40+) 날카로운 산 모양이 됩니다.
- release(5-1)를 0.12 정도로 낮추면 물결처럼 흐릅니다.

---

### F. 미니멀 라인

가는 선 48개입니다. 존재감이 적어 화면이 가장 단정합니다. 선 전체를 **한 번의 `stroke()`**로 그려서 가장 가볍습니다.

```ts
function drawLines(ctx: CanvasRenderingContext2D, w: number, h: number, v0: Float32Array) {
  const n = 48, v = regroup(v0, n), step = w / n;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = vGrad(ctx, h);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = step * (i + 0.5), bh = Math.max(2, v[i] * h * 0.9);
    ctx.moveTo(x, h - 1);
    ctx.lineTo(x, h - bh);
  }
  ctx.stroke();
}
```

- 48밴드를 쓰므로 **분석도 48밴드**로 하는 것이 좋습니다(`EQ_BANDS = 48`).
- 선 굵기 1.5px + 높이 40px이면 미니 플레이어나 목록 행에도 들어갑니다.

---

### 디자인 고르기 요약

| 시안 | 막대/요소 수 | 추천 높이 | 그리기 비용 | 어울리는 화면 |
|---|---|---|---|---|
| A 클래식 막대 | 28 | 56~72px | 낮음 | 범용 (플레이어 메인) |
| B 미러 막대 | 32 | 56~80px | 낮음 | 차분한 음악, 다크 UI |
| C 피크 홀드 | 28 + 캡 28 | 64~96px | 낮음 | 오디오 장비 느낌, 리듬감 강조 |
| D LED 도트 | 22×10 = 220 | 72~120px | 중간 | 레트로·하이파이 |
| E 스무스 웨이브 | 곡선 1개 | 48~80px | 낮음 | 감성·명상·발라드 |
| F 미니멀 라인 | 48 (stroke 1번) | 32~64px | 가장 낮음 | 미니 플레이어, 목록 |

---

## 7. 연동 예시

### 7-1. React 컴포넌트 (cnation-mb 실제 코드를 일반화)

```tsx
import { useEffect, useRef } from 'react';
import { analyzeTrack, bandsAt, EQ_BANDS, type Spectrum } from './spectrum';

type Render = (ctx: CanvasRenderingContext2D, w: number, h: number, v: Float32Array) => void;

export function Equalizer({
  audio,          // 재생 중인 <audio> 요소
  trackId,        // 곡 식별자 (바뀌면 다시 분석)
  url,            // 곡 URL (blob: 포함)
  size,           // 파일 크기 (너무 크면 분석 생략)
  render,         // drawBars / drawMirror / ... 중 하나
  height = 64,
}: { audio: HTMLAudioElement; trackId: string; url: string; size: number; render: Render; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const spec = useRef<Spectrum | null>(null);

  // 곡이 바뀌면 분석
  useEffect(() => {
    spec.current = null;
    let alive = true;
    analyzeTrack(trackId, url, size).then((s) => { if (alive) spec.current = s; });
    return () => { alive = false; };
  }, [trackId, url, size]);

  // 그리기 루프
  useEffect(() => {
    const c = canvas.current!, ctx = c.getContext('2d')!;
    const level = new Float32Array(EQ_BANDS).fill(0.03), target = new Float32Array(EQ_BANDS);
    let w = 0, h = 0, raf = 0;
    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1), r = c.getBoundingClientRect();
      w = r.width; h = r.height; c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(c);
    const draw = () => {
      raf = 0;
      if (document.hidden) return;
      const playing = !audio.paused;
      if (playing && spec.current) bandsAt(spec.current, audio.currentTime, target);
      else target.fill(playing ? 0.06 : 0.03);
      let moving = false;
      for (let i = 0; i < EQ_BANDS; i++) {
        const d = target[i] - level[i];
        level[i] += d * (d > 0 ? 0.55 : 0.18);
        if (Math.abs(d) > 0.004) moving = true;
      }
      render(ctx, w, h, level);
      if (playing || moving) raf = requestAnimationFrame(draw);
    };
    const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(draw); };
    kick();
    audio.addEventListener('play', kick);
    audio.addEventListener('pause', kick);
    document.addEventListener('visibilitychange', kick);
    return () => {
      ro.disconnect(); if (raf) cancelAnimationFrame(raf);
      audio.removeEventListener('play', kick); audio.removeEventListener('pause', kick);
      document.removeEventListener('visibilitychange', kick);
    };
  }, [audio, render]);

  return <canvas ref={canvas} style={{ display: 'block', width: '100%', height }} role="img" aria-label="이퀄라이저" />;
}

// 사용
// <Equalizer audio={audioEl} trackId={t.id} url={t.url} size={t.size} render={drawBars} />
```

### 7-2. 바닐라 JS (프레임워크 없이)

```html
<audio id="player" src="song.mp3" controls></audio>
<canvas id="eq" style="width:100%;height:64px;display:block"></canvas>
<script type="module">
  import { analyzeTrack, bandsAt, EQ_BANDS } from './spectrum.js';
  import { drawBars } from './eq-designs.js';

  const audio = document.getElementById('player');
  const canvas = document.getElementById('eq');
  const ctx = canvas.getContext('2d');
  const level = new Float32Array(EQ_BANDS).fill(0.03), target = new Float32Array(EQ_BANDS);
  let spec = null, w = 0, h = 0, raf = 0;

  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1), r = canvas.getBoundingClientRect();
    w = r.width; h = r.height; canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas); resize();

  audio.addEventListener('loadedmetadata', async () => {
    spec = null;
    spec = await analyzeTrack(audio.currentSrc, audio.currentSrc, 0);
  });

  function draw() {
    raf = 0;
    if (document.hidden) return;
    const playing = !audio.paused;
    if (playing && spec) bandsAt(spec, audio.currentTime, target); else target.fill(0.03);
    let moving = false;
    for (let i = 0; i < EQ_BANDS; i++) {
      const d = target[i] - level[i]; level[i] += d * (d > 0 ? 0.55 : 0.18);
      if (Math.abs(d) > 0.004) moving = true;
    }
    drawBars(ctx, w, h, level);
    if (playing || moving) raf = requestAnimationFrame(draw);
  }
  const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(draw); };
  ['play', 'pause'].forEach((e) => audio.addEventListener(e, kick));
  document.addEventListener('visibilitychange', kick);
</script>
```

> 원격 URL(다른 도메인)의 음악을 분석하려면 그 서버가 **CORS를 허용**해야 `fetch`가 됩니다. 재생(`<audio>`)은 CORS 없이도 되지만 분석은 안 됩니다. 이 경우 분석을 생략하고 막대만 낮게 두면 됩니다.

---

## 8. 성능 · 메모리

5분 곡(44.1kHz 스테레오 mp3 약 7MB) 기준 추정치입니다.

| 항목 | 값 |
|---|---|
| 저음질 디코딩 결과 (11025Hz 모노 Float32) | 5분 × 11025 × 4B ≈ **13 MB** (분석 중에만, 워커로 넘긴 뒤 해제) |
| 분석 결과 (28밴드 × 6,460프레임, Uint8) | ≈ **180 KB** (캐시 6곡 ≈ 1MB) |
| FFT 연산량 | 6,460 × 512점 FFT ≈ 수십 ms ~ 수백 ms (워커, 화면 안 멈춤) |
| 분석 총 시간 | 대부분 디코딩 시간 — 아이폰 최신 기종 0.3~1초 |
| 그리기 비용 | 막대 28개 × 60fps → CPU 1~2% 수준, 화면 꺼지면 0 |

**메모리 주의:** 브라우저는 디코딩 도중 원본 품질(44.1k 스테레오)로 잠깐 풀었다가 리샘플할 수 있습니다. 그래서 아주 긴 곡이나 큰 무손실 파일은 일시적으로 수백 MB를 쓸 수 있습니다. 그래서 `MAX_BYTES`(80MB)로 상한을 둡니다.

---

## 9. iOS·Safari 주의사항

| 주의 | 이유 / 대처 |
|---|---|
| **재생을 Web Audio로 하지 말 것** | `createMediaElementSource`로 `<audio>`를 연결하는 순간, 백그라운드·잠금화면에서 소리가 끊깁니다. 분석은 **같은 파일을 따로 디코딩**해서 합니다 |
| 워커에 `OfflineAudioContext` 없음 | 디코딩은 메인 스레드, FFT만 워커에서 |
| `decodeAudioData` 콜백/Promise | 구형 Safari는 콜백만 지원 → 3-2처럼 둘 다 처리 |
| `ctx.roundRect` 미지원 (iOS 15 이하) | `rect`로 대체 (6-0의 `rr`) |
| 화면이 꺼지면 rAF 중단 | 정상 동작. `visibilitychange`에서 다시 시작 |
| `audio.currentTime` 정밀도 | iOS도 충분히 정밀함. `timeupdate`(250ms)에 의존하지 말 것 |
| 지원 포맷 | iOS는 mp3·m4a·aac·wav·flac, 최신 iOS는 ogg/opus도 지원. 디코딩이 실패하면 null → 막대만 낮게 |

---

## 10. 튜닝 가이드

| 파라미터 | 위치 | 기본 | 올리면 | 내리면 |
|---|---|---|---|---|
| `SR` | 분석 | 11025 | 고음(5kHz↑)까지 표시, 메모리↑ | 메모리↓, 고음 표시 범위↓ |
| `FFT` | 분석 | 512 | 저음 해상도↑ (막대 구분 또렷) | 시간 반응↑ |
| `HOP` | 분석 | 512 (46ms) | 결과 크기↓, 반응 둔해짐 | 반응 촘촘, 결과 크기↑ |
| `fLo / fHi` | 분석 | 50Hz / 5kHz | — | 보컬 위주면 `fLo=80` |
| 고음 기울기 | 분석 | +9dB | 오른쪽 막대가 더 높아짐 | 저음 위주로 보임 |
| 상위 퍼센타일 | 분석 | 98% | 막대가 덜 꽉 참 (여유) | 더 자주 꼭대기 닿음 |
| 동적 범위 | 분석 | 45dB | 조용한 부분도 막대 보임 (평평) | 대비 강함 (출렁임↑) |
| attack | 그리기 | 0.55 | 즉각 반응 | 부드럽게 올라감 |
| release | 그리기 | 0.18 | 빨리 떨어짐 (딱딱) | 천천히 출렁임 |
| 최소 높이 | 그리기 | 3px | 조용할 때도 막대 줄 선명 | 무음 시 거의 안 보임 |
| DPR 상한 | 그리기 | 2 | 더 선명 (배터리↑) | 배터리↓ |

**자주 쓰는 프리셋**

- **펀치감 (EDM·댄스):** 동적 범위 35dB, attack 0.7, release 0.25
- **부드러움 (발라드·피아노):** 동적 범위 50dB, attack 0.35, release 0.1, 디자인 E
- **보컬 강조:** `fLo=80`, `fHi=4000`, 기울기 +6dB

---

## 11. 테스트 방법

### 11-1. 주파수 스윕으로 정확도 확인

저음 → 고음으로 올라가는 테스트 음을 만들면, **가장 높은 막대가 시간에 맞춰 왼쪽 → 오른쪽으로 고르게 이동**해야 정상입니다.

```bash
# 60Hz → 5kHz 로그 스윕 20초
ffmpeg -f lavfi -i "aevalsrc='0.4*sin(2*PI*(60*exp(t*log(5000/60)/20)/(log(5000/60)/20)))':s=44100:d=20" \
  -c:a libmp3lame -b:a 192k sweep.mp3
```

cnation-mb 실측 결과(28밴드): 1·5·9·13·17초에 최고 막대가 **3 → 8 → 13 → 19 → 24번**으로 이동했습니다(로그 간격이라 등간격 이동이 정상).

### 11-2. 캔버스 픽셀로 자동 검사 (Playwright)

```js
const heights = await page.evaluate(() => {
  const c = document.querySelector('canvas[aria-label="이퀄라이저"]');
  const ctx = c.getContext('2d'), W = c.width, H = c.height, n = 28;
  const img = ctx.getImageData(0, 0, W, H).data, out = [];
  for (let i = 0; i < n; i++) {
    const x = Math.floor((i + 0.5) * W / n); let k = 0;
    for (let y = 0; y < H; y++) if (img[(y * W + x) * 4 + 3] > 0) k++;
    out.push(Math.round(k / H * 100));   // 막대 높이 %
  }
  return out;
});
// 일시정지 1.5초 후 → 모든 값이 최소 높이(약 5%)여야 함
```

### 11-3. 체크리스트

- [ ] 재생 중 화면을 잠가도 소리가 계속 나는가 (iPhone)
- [ ] 다른 앱 갔다 와도 막대가 다시 움직이는가
- [ ] 일시정지 → 막대가 가라앉고 CPU 사용이 멈추는가
- [ ] 곡을 넘기면 0.5~1초 안에 새 곡에 맞춰 움직이는가
- [ ] 큰 파일(80MB↑)은 분석 없이도 재생이 정상인가

---

## 12. 문제 해결 FAQ

**Q. 막대가 항상 왼쪽(저음)만 높아요.**
음악은 원래 저음 에너지가 큽니다. 고음 기울기(+9dB)를 +12~15dB로 올리거나 `fLo`를 80Hz로 올리세요.

**Q. 막대가 계속 꼭대기에 붙어 있어요.**
상위 퍼센타일(98%)을 99.5%로 올리거나 동적 범위(45dB)를 55dB로 늘리세요.

**Q. 소리와 막대가 살짝 어긋나요.**
`bandsAt(spec, audio.currentTime + 0.03, …)`처럼 20~50ms 앞당겨 보세요. 블루투스 이어폰은 지연이 150~250ms라서 그만큼 **늦춰야**(−0.2) 맞습니다.

**Q. 곡이 시작될 때 1초 정도 막대가 안 움직여요.**
분석 중이라 그렇습니다. 분석 결과를 IndexedDB에 저장해 두거나, 목록의 다음 곡을 미리 `analyzeTrack`해 두면(프리로드) 바로 움직입니다.

**Q. 분석이 실패해요 (null).**
① 다른 도메인 URL인데 CORS가 막힌 경우, ② 브라우저가 디코딩할 수 없는 포맷, ③ `MAX_BYTES` 초과입니다. 어떤 경우든 재생은 정상이고 막대만 낮게 유지됩니다.

**Q. 실시간 마이크 입력을 보여주고 싶어요.**
그건 미리 분석할 수 없으므로 `getUserMedia` → `AnalyserNode`(① 방식)를 써야 합니다. 그리기 함수(6장)는 그대로 재사용할 수 있습니다. `analyser.getByteFrequencyData()` 결과를 `/255`해서 `v`로 넘기면 됩니다.
