// 화면 담당. 로직(재생, 요약, priority 선별, 전송 순서)은 모두 Rust(sim.rs)에 있다.
// 여기서는 Rust가 준 값을 그리고, 보낼 파일을 zstd로 압축해서 Rust에 돌려준다.
import init, { Sim } from './pkg/space_sim.js';

// ===== 설정 (두 창이 같은 값을 써야 한다) =====
const LINK_BYTES_PER_SEC = 10 * 1024;     // 링크 속도 (테스트용 값)
const TX_DELAY_MS = 22 * 60000;           // 편도 전송 지연
const CLOCK_LAG_MS_MARS = 22 * 60000;     // 화성 시계가 늦은 정도
const COLD_EVERY_MS = 60 * 60000;         // A_cold 정각 발송 주기
const PRIO_EVERY_MS = 1000;               // A_priority 발송 주기
const PLAY_INTERVAL_MS = 10;              // 원본 1행 출력 간격 (1초에 최대 100행)
const ZSTD_LEVEL = 3;

// ===== 창 역할 =====
const SIDE = new URLSearchParams(location.search).get('side') === 'mars' ? 'mars' : 'earth';
const SIDE_NAME = SIDE === 'earth' ? 'Earth' : 'Mars';
const LAG_MS = SIDE === 'mars' ? CLOCK_LAG_MS_MARS : 0;
const TZ = -new Date().getTimezoneOffset(); // 로컬 시간대 (분)

const $ = id => document.getElementById(id);
$('title').textContent = `${SIDE_NAME} window`;
document.title = `${SIDE_NAME} - Space Link Simulator`;
if (SIDE === 'mars') $('marsPanel').style.display = 'grid';

// ===== Rust 로직 =====
await init();
const sim = new Sim(
  SIDE === 'mars', TZ, LAG_MS, TX_DELAY_MS, LINK_BYTES_PER_SEC,
  COLD_EVERY_MS, PRIO_EVERY_MS, Date.now()
);

// ===== zstd (로딩 실패해도 나머지 화면은 동작) =====
// 원본 패키지는 확장자 없는 import라 브라우저에서 안 열리므로 jsdelivr의 /+esm 묶음을 쓴다.
let zstdCompress = null;
let zstdReady = false;
import('https://cdn.jsdelivr.net/npm/@bokuweb/zstd-wasm@0.0.27/+esm')
  .then(async m => {
    await m.init('https://cdn.jsdelivr.net/npm/@bokuweb/zstd-wasm@0.0.27/dist/esm/zstd.wasm');
    zstdCompress = m.compress;
    zstdReady = true;
  })
  .catch(err => {
    console.error('Failed to load zstd', err);
  });

function compress(text) {
  return zstdCompress(new TextEncoder().encode(text), ZSTD_LEVEL);
}

// ===== 전송 (Rust가 순서를 정하고, 여기서는 바이트를 실어 보낸다) =====
const channel = new BroadcastChannel('space-sim');
const pendingBytes = new Map(); // 기록 번호 → 압축된 바이트
const inTransit = [];           // 상대가 보낸 것 중 아직 도착 안 한 것
const inbox = [];               // 받은 기록

channel.onmessage = e => {
  if (e.data.from !== SIDE) inTransit.push(e.data);
};

// Rust가 보낼 파일을 만들면 압축해서 기록에 올린다
function pumpRequests(now) {
  if (SIDE !== 'mars' || !zstdReady) return;
  for (;;) {
    const s = sim.nextRequest(now);
    if (!s) break;
    const req = JSON.parse(s);
    const bytes = compress(req.text);
    const id = sim.enqueue(req.kind, req.name, bytes.length);
    pendingBytes.set(id, bytes);
  }
}

// 링크가 비었으면 Rust가 고른 다음 파일을 실제로 보낸다
function pumpDispatch(now) {
  for (;;) {
    const s = sim.dispatch(now);
    if (!s) break;
    const d = JSON.parse(s);
    const bytes = pendingBytes.get(d.blockId);
    pendingBytes.delete(d.blockId);
    channel.postMessage({
      from: SIDE,
      id: d.blockId,
      name: d.name,
      size: bytes.length,
      bytes,
      arriveAt: d.arriveAt,
    });
  }
}

// 도착 시각이 지난 받은 파일을 inbox로 옮긴다
function moveArrivals(now) {
  let changed = false;
  for (let i = inTransit.length - 1; i >= 0; i--) {
    if (now >= inTransit[i].arriveAt) {
      const [m] = inTransit.splice(i, 1);
      inbox.unshift({
        ...m,
        url: URL.createObjectURL(new Blob([m.bytes], { type: 'application/octet-stream' })),
        receivedAt: now - LAG_MS,
      });
      changed = true;
    }
  }
  return changed;
}

// ===== 재생 =====
let playFileSize = 0;
setInterval(() => sim.playStep(), PLAY_INTERVAL_MS);

$('hotInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  $('hotFileName').textContent = file.name;
  try {
    sim.load(await file.text());
    playFileSize = file.size;
  } catch (err) {
    alert(err.message || String(err));
  }
  e.target.value = '';
  render(JSON.parse(sim.snapshot(Date.now())));
});

$('playBtn').addEventListener('click', () => {
  const snap = JSON.parse(sim.snapshot(Date.now()));
  sim.setPlaying(!snap.playing);
});

$('resetBtn').addEventListener('click', () => sim.reset());
$('flushBtn').addEventListener('click', () => sim.force('cold'));
$('priorityBtn').addEventListener('click', () => sim.force('priority'));

$('blockDownload').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([sim.blocksCsv(Date.now())], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blocks.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ===== 화면 그리기 =====
function fillTable(id, headers, rows) {
  const table = $(id);
  const head = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    head.appendChild(th);
  }
  const body = rows.map(r => {
    const tr = document.createElement('tr');
    for (const v of r) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    return tr;
  });
  table.replaceChildren(head, ...body);
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// 용량 비교: 누적 텍스트를 zstd로 압축해서 잰다. 행이 없으면 0 B.
function renderSizes() {
  const texts = JSON.parse(sim.sizeTexts());
  const sizeOf = t => {
    if (t === '') return 0;
    return zstdReady ? compress(t).length : null;
  };
  const show = v => (v === null ? 'Loading' : fmtBytes(v));
  fillTable('sizeTable', ['Cumulative', 'Size'], [
    ['File total (full raw)', playFileSize ? fmtBytes(playFileSize) : '-'],
    ['hot total (full raw + zstd)', show(sizeOf(texts.hot))],
    ['cold total (summary, zstd)', show(sizeOf(texts.cold))],
    ['priority total (zstd only)', show(sizeOf(texts.prio))],
  ]);
}

function renderInbox() {
  $('inbox').replaceChildren(...inbox.map(m => {
    const li = document.createElement('li');
    li.textContent = `📄 ${m.name} (${fmtBytes(m.size)}) `;
    const a = document.createElement('a');
    a.href = m.url;
    a.download = m.name;
    a.textContent = 'Download';
    li.appendChild(a);
    const meta = document.createElement('span');
    meta.className = 'sub';
    const t = ms => new Date(ms).toLocaleTimeString('en-GB', { hour12: false });
    meta.textContent = `  [sent by ${m.from === 'mars' ? 'Mars' : 'Earth'} · arrived ${t(m.receivedAt)}]`;
    li.appendChild(meta);
    return li;
  }));
}

let lastInboxCount = -1;

function render(snap) {
  $('clock').textContent = snap.clock;
  $('date').textContent = snap.date;

  fillTable('blockTable',
    ['block_id', 'Clock', 'Send start', 'File', 'Size', 'Status', 'ETA'],
    snap.blocks);

  if (SIDE === 'mars') {
    $('playBtn').textContent = snap.playing ? 'Pause' : 'Start playback';
    $('hotStatus').textContent =
      `Loaded ${snap.loaded} rows | Played ${snap.played} rows | Raw ${snap.hotCount} rows | Summarized biomarkers ${snap.coldRows.length}`;
    $('sendInfo').textContent = `Next scheduled send: ${snap.nextCold} · every ${COLD_EVERY_MS / 60000} min`;
    $('priorityStatus').textContent =
      `Pending ${snap.prioPending} rows · Sent ${snap.prioSent} rows · sends every ${PRIO_EVERY_MS / 1000} s`;

    fillTable('hotTable', ['timestamp', 'Biomarker', 'Figure', 'Status'], snap.hotRows);
    fillTable('coldTable',
      ['Biomarker', 'count', 'min', 'max', 'mean', 'start_timestamp', 'end_timestamp'],
      snap.coldRows);
    fillTable('prioTable',
      ['timestamp', 'Biomarker', 'Figure', 'Status', 'Reason', 'State'],
      snap.prioRows);
    $('convLog').replaceChildren(...snap.convLog.map(t => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }));
    renderSizes();
  }

  if (inbox.length !== lastInboxCount) {
    renderInbox();
    lastInboxCount = inbox.length;
  }
}

// ===== 주기 작업 (200ms) =====
function tick() {
  const now = Date.now();
  pumpRequests(now);
  pumpDispatch(now);
  if (moveArrivals(now)) renderInbox();
  render(JSON.parse(sim.snapshot(now)));
}

setInterval(tick, 200);
tick();
