//! 화성 ↔ 지구 통신 시뮬레이터의 순수 로직.
//! 브라우저 바인딩(lib.rs)과 분리해 두어 `cargo test`로 바로 검증할 수 있다.
//! 시간은 모두 ms 정수이고, 화면 표시용 문자열은 여기서 만든다.

use serde_json::{json, Value};
use std::collections::{BTreeMap, VecDeque};
use crate::ccsds;
use std::fmt::Write;

/// 원본을 데이터 시간 기준으로 이만큼 보관하고, 넘기면 요약에 반영한다 (60초)
pub const HOT_KEEP_MS: i64 = 60_000;
/// 이상치가 있는 바이오마커의 처음 N행도 priority에 같이 넣는다
pub const PRIO_CONTEXT_N: usize = 3;
const DAY_MS: i64 = 86_400_000;
const HOT_HEADER: &str = "timestamp,Biomarker,Figure,Status";
const LOG_LIMIT: usize = 100;

pub fn is_priority(status: &str) -> bool {
    status == "Critical" || status == "Warning"
}

/// 예전 파일의 한국어 상태값(정상/경고/위험)도 영어로 맞춰 읽는다
pub fn normalize_status(s: &str) -> String {
    match s {
        "정상" => "Normal",
        "경고" => "Warning",
        "위험" => "Critical",
        other => other,
    }
    .to_string()
}

// ---------- 설정 ----------

#[derive(Clone, Debug)]
pub struct Config {
    pub is_mars: bool,
    /// 로컬 시간대 오프셋 (분). 예: 한국 = 540
    pub tz_offset_min: i64,
    /// 화성 시계가 늦은 정도 (ms). 지구는 0
    pub clock_lag_ms: i64,
    /// 편도 전송 지연 (ms)
    pub tx_delay_ms: i64,
    /// 링크 속도 (바이트/초)
    pub link_bytes_per_sec: f64,
    /// A_cold 정각 발송 주기 (ms)
    pub cold_every_ms: i64,
    /// A_priority 발송 주기 (ms)
    pub prio_every_ms: i64,
}

// ---------- 데이터 모델 ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// 이상치 행: 항상 먼저 전송
    Priority,
    /// Normal 요약, blocks.csv 등
    Bulk,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "priority" => Some(Kind::Priority),
            "bulk" => Some(Kind::Bulk),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Priority => "priority",
            Kind::Bulk => "bulk",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Row {
    pub ts: i64,
    pub biomarker: String,
    pub figure: f64,
    pub status: String,
    /// 이상치가 있는 바이오마커의 처음 N행이면 true
    pub ctx: bool,
    /// priority로 간 이유 ("이상치" / "맥락" / "")
    pub reason: &'static str,
}

#[derive(Clone, Debug)]
struct Acc {
    count: u64,
    sum: f64,
    min: f64,
    max: f64,
    start: i64,
    end: i64,
}

#[derive(Clone, Debug)]
pub struct Block {
    pub id: u32,
    pub from: &'static str,
    pub name: String,
    /// 압축 후 크기 (바이트). JS가 압축해서 알려준다
    pub size: f64,
    pub started: bool,
    /// 전송 시작 (보내는 쪽 시계, ms)
    pub sent_clock: i64,
    pub arrive_clock: i64,
    /// 실제 시간 기준 (ms)
    pub tx_end: i64,
    pub arrive_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Req {
    Priority,
    Cold,
    Blocks,
}

/// JS가 압축해서 `enqueue`로 돌려줄 파일 요청
pub struct Outgoing {
    pub kind: Kind,
    pub name: String,
    pub text: String,
    /// 이미 압축된 바이트 (A_cold: 숫자 열 + CCSDS 121). None이면 JS가 text를 zstd로 압축한다
    pub payload: Option<Vec<u8>>,
}

/// 링크가 비어서 실제로 보내기 시작한 항목
pub struct Dispatched {
    pub block_id: u32,
    pub kind: Kind,
    pub name: String,
    pub arrive_at: i64,
}

// ---------- 날짜 / CSV ----------

/// 1970-01-01 기준 날짜 번호 (Howard Hinnant 알고리즘)
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// "2026-01-01 07:00" 또는 "2026-01-01 07:00:00"을 UTC ms로 바꾼다.
/// 파일 시각은 로컬 시간으로 보고 tz_offset_min으로 보정한다.
pub fn parse_ts(s: &str, tz: i64) -> Option<i64> {
    let (date, time) = s.trim().split_once(' ')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let mut t = time.split(':').map(|x| x.parse::<i64>().ok());
    let (hh, mm) = (t.next()??, t.next()??);
    let ss = t.next().flatten().unwrap_or(0);
    let local = (days_from_civil(y, m, day) * 24 + hh) * 3_600_000 + mm * 60_000 + ss * 1000;
    Some(local - tz * 60_000)
}

/// UTC ms → "YYYY-MM-DD HH:MM:SS" (로컬 시간)
pub fn fmt_local(ms: i64, tz: i64) -> String {
    let local = ms + tz * 60_000;
    let (y, m, d) = civil_from_days(local.div_euclid(DAY_MS));
    let rem = local.rem_euclid(DAY_MS) / 1000;
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}",
        rem / 3600,
        rem / 60 % 60,
        rem % 60
    )
}

fn format_bytes(n: f64) -> String {
    if n < 1024.0 {
        format!("{} B", n as u64)
    } else if n < 1024.0 * 1024.0 {
        format!("{:.1} KB", n / 1024.0)
    } else {
        format!("{:.2} MB", n / 1024.0 / 1024.0)
    }
}

/// CSV 한 줄을 Row로 바꾼다. 첫 줄은 머리글, 첫 열 BOM은 제거한다.
pub fn parse_csv(text: &str, tz: i64) -> Result<Vec<Row>, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    let header: Vec<&str> = lines
        .next()
        .ok_or_else(|| "The file is empty".to_string())?
        .split(',')
        .map(str::trim)
        .collect();
    let find = |name: &str| {
        header
            .iter()
            .position(|h| *h == name)
            .ok_or_else(|| format!("A_hot.csv needs a {name} column"))
    };
    let (i_ts, i_bio, i_fig) = (find("timestamp")?, find("Biomarker")?, find("Figure")?);
    let i_status = header.iter().position(|h| *h == "Status");

    let mut rows = Vec::new();
    for (n, line) in lines.enumerate() {
        let cols: Vec<&str> = line.split(',').collect();
        let get = |i: usize| cols.get(i).map(|s| s.trim()).unwrap_or("");
        let ts = parse_ts(get(i_ts), tz)
            .ok_or_else(|| format!("Row {}: invalid timestamp ({})", n + 2, get(i_ts)))?;
        rows.push(Row {
            ts,
            biomarker: get(i_bio).to_string(),
            figure: get(i_fig).parse().unwrap_or(f64::NAN),
            status: i_status.map(|i| normalize_status(get(i))).unwrap_or_default(),
            ctx: false,
            reason: "",
        });
    }
    Ok(rows)
}

/// 이상치가 있는 바이오마커의 처음 PRIO_CONTEXT_N행에 ctx 표시
pub fn mark_context(rows: &mut [Row]) {
    let anomaly: std::collections::HashSet<String> = rows
        .iter()
        .filter(|r| is_priority(&r.status))
        .map(|r| r.biomarker.clone())
        .collect();
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for r in rows.iter_mut() {
        let n = seen.entry(r.biomarker.clone()).or_insert(0);
        r.ctx = anomaly.contains(&r.biomarker) && *n < PRIO_CONTEXT_N;
        *n += 1;
    }
}

fn csv_line(r: &Row, tz: i64) -> String {
    format!("{},{},{},{}", fmt_local(r.ts, tz), r.biomarker, r.figure, r.status)
}

fn block_status(b: &Block, now: i64) -> &'static str {
    if !b.started {
        "Queued"
    } else if now < b.tx_end {
        "Sending"
    } else if now < b.arrive_at {
        "In transit"
    } else {
        "Arrived"
    }
}

// ---------- 시뮬레이터 상태 ----------

pub struct Sim {
    cfg: Config,
    rows: Vec<Row>,
    play_idx: usize,
    playing: bool,

    /// 화면에 남아 있는 원본 (보관 기간 안)
    hot: VecDeque<Row>,
    latest_ts: Option<i64>,
    /// 바이오마커별 Normal 요약 누적 (O(1) 갱신)
    summary: BTreeMap<String, Acc>,

    /// hot에 들어온 원본 누적 (CSV 줄 단위)
    ingested_rows: u64,
    ingested_text: String,
    /// 요약으로 넘긴 원본 행 수
    absorbed_rows: u64,

    /// 이상치·맥락 행
    prio_pending: Vec<Row>,
    prio_all: Vec<Row>,
    prio_text: String,
    prio_sent: usize,

    queue_prio: VecDeque<u32>,
    queue_bulk: VecDeque<u32>,
    blocks: Vec<Block>,
    link_free_at: i64,

    last_prio_key: i64,
    last_cold_key: i64,
    requests: VecDeque<Req>,
    logs: VecDeque<String>,
}

impl Sim {
    pub fn new(cfg: Config, now: i64) -> Sim {
        let clock = now - cfg.clock_lag_ms;
        let last_prio_key = clock.div_euclid(cfg.prio_every_ms);
        let last_cold_key = clock.div_euclid(cfg.cold_every_ms);
        Sim {
            cfg,
            rows: Vec::new(),
            play_idx: 0,
            playing: false,
            hot: VecDeque::new(),
            latest_ts: None,
            summary: BTreeMap::new(),
            ingested_rows: 0,
            ingested_text: String::new(),
            absorbed_rows: 0,
            prio_pending: Vec::new(),
            prio_all: Vec::new(),
            prio_text: String::new(),
            prio_sent: 0,
            queue_prio: VecDeque::new(),
            queue_bulk: VecDeque::new(),
            blocks: Vec::new(),
            link_free_at: 0,
            last_prio_key,
            last_cold_key,
            requests: VecDeque::new(),
            logs: VecDeque::new(),
        }
    }

    fn my_clock(&self, now: i64) -> i64 {
        now - self.cfg.clock_lag_ms
    }

    fn log(&mut self, msg: String) {
        self.logs.push_front(msg);
        self.logs.truncate(LOG_LIMIT);
    }

    /// 원본 파일을 읽고 재생 상태를 처음으로 되돌린다 (전송 기록은 유지)
    pub fn load(&mut self, text: &str) -> Result<(), String> {
        let mut rows = parse_csv(text, self.cfg.tz_offset_min)?;
        mark_context(&mut rows);
        self.rows = rows;
        self.reset();
        Ok(())
    }

    pub fn reset(&mut self) {
        self.play_idx = 0;
        self.playing = false;
        self.hot.clear();
        self.latest_ts = None;
        self.summary.clear();
        self.ingested_rows = 0;
        self.ingested_text.clear();
        self.absorbed_rows = 0;
        self.prio_pending.clear();
        self.prio_all.clear();
        self.prio_text.clear();
        self.prio_sent = 0;
        self.requests.clear();
        self.logs.clear();
    }

    pub fn set_playing(&mut self, on: bool) {
        self.playing = on && self.play_idx < self.rows.len();
    }

    /// 원본 1행을 출력한다. 호출 주기가 곧 재생 속도다.
    pub fn play_step(&mut self) {
        if !self.playing {
            return;
        }
        if self.play_idx >= self.rows.len() {
            self.finish();
            return;
        }
        let row = self.rows[self.play_idx].clone();
        self.play_idx += 1;
        self.ingest(row);
        self.convert_expired();
        if self.play_idx >= self.rows.len() {
            self.finish();
        }
    }

    fn ingest(&mut self, row: Row) {
        let tz = self.cfg.tz_offset_min;
        let line = csv_line(&row, tz);
        self.ingested_rows += 1;
        self.ingested_text.push_str(&line);
        self.ingested_text.push('\n');
        self.latest_ts = Some(self.latest_ts.map_or(row.ts, |t| t.max(row.ts)));

        let anomaly = is_priority(&row.status);
        if anomaly || row.ctx {
            let mut p = row.clone();
            p.reason = if anomaly { "Anomaly" } else { "Context" };
            self.prio_text.push_str(&line);
            self.prio_text.push('\n');
            self.prio_all.push(p.clone());
            self.prio_pending.push(p);
        }
        self.hot.push_back(row);
    }

    /// 보관 기간(60초)을 넘긴 원본을 요약에 반영하고 hot에서 뺀다
    fn convert_expired(&mut self) {
        let Some(latest) = self.latest_ts else { return };
        let cutoff = latest - HOT_KEEP_MS;
        let mut expired = Vec::new();
        while let Some(front) = self.hot.front() {
            if front.ts > cutoff {
                break;
            }
            expired.push(self.hot.pop_front().expect("front 확인함"));
        }
        self.absorb(expired, latest, "");
    }

    /// 출력이 끝나면 hot에 남은 행까지 전부 요약에 반영하고 멈춘다
    fn finish(&mut self) {
        self.playing = false;
        let at = self.latest_ts.unwrap_or(0);
        let rest: Vec<Row> = self.hot.drain(..).collect();
        self.absorb(rest, at, "Playback done · ");
    }

    fn absorb(&mut self, rows: Vec<Row>, at: i64, prefix: &str) {
        if rows.is_empty() {
            return;
        }
        let mut per: BTreeMap<String, usize> = BTreeMap::new();
        for r in &rows {
            self.absorbed_rows += 1;
            *per.entry(r.biomarker.clone()).or_insert(0) += 1;
            // 요약은 Normal 행만
            if r.status == "Normal" && r.figure.is_finite() {
                self.add_summary(r);
            }
        }
        let detail: Vec<String> = per.iter().map(|(n, c)| format!("{n} {c}")).collect();
        let msg = format!(
            "{prefix}{} {} raw rows → added to summary ({})",
            &fmt_local(at, self.cfg.tz_offset_min)[11..],
            rows.len(),
            detail.join(", ")
        );
        self.log(msg);
    }

    /// O(1) 누적: count, sum, min, max, 시작·끝 시각
    fn add_summary(&mut self, r: &Row) {
        let acc = self.summary.entry(r.biomarker.clone()).or_insert(Acc {
            count: 0,
            sum: 0.0,
            min: r.figure,
            max: r.figure,
            start: r.ts,
            end: r.ts,
        });
        acc.count += 1;
        acc.sum += r.figure;
        acc.min = acc.min.min(r.figure);
        acc.max = acc.max.max(r.figure);
        acc.start = acc.start.min(r.ts);
        acc.end = acc.end.max(r.ts);
    }

    // ---------- 발송 요청 ----------

    /// 발송 시각이 되었으면 요청을 쌓고, 가장 앞의 요청 하나를 파일로 만들어 돌려준다.
    /// JS는 None이 나올 때까지 반복 호출하고, 받은 파일을 압축해서 `enqueue`한다.
    pub fn next_request(&mut self, now: i64) -> Option<Outgoing> {
        let clock = self.my_clock(now);

        let prio_key = clock.div_euclid(self.cfg.prio_every_ms);
        if prio_key > self.last_prio_key {
            self.last_prio_key = prio_key;
            if !self.prio_pending.is_empty() {
                self.requests.push_back(Req::Priority);
            }
        }

        let cold_key = clock.div_euclid(self.cfg.cold_every_ms);
        if cold_key > self.last_cold_key {
            self.last_cold_key = cold_key;
            self.requests.push_back(Req::Cold);
            self.requests.push_back(Req::Blocks);
        }

        while let Some(req) = self.requests.pop_front() {
            if let Some(out) = self.build(req, now) {
                return Some(out);
            }
        }
        None
    }

    /// 버튼으로 바로 보내기 ("priority" | "cold")
    pub fn force(&mut self, kind: &str) {
        match kind {
            "priority" => self.requests.push_back(Req::Priority),
            "cold" => {
                self.requests.push_back(Req::Cold);
                self.requests.push_back(Req::Blocks);
            }
            _ => {}
        }
    }

    fn build(&mut self, req: Req, now: i64) -> Option<Outgoing> {
        let tz = self.cfg.tz_offset_min;
        match req {
            Req::Priority => {
                if self.prio_pending.is_empty() {
                    return None;
                }
                let rows: Vec<Row> = self.prio_pending.drain(..).collect();
                self.prio_sent += rows.len();
                let mut text = String::from(HOT_HEADER);
                text.push('\n');
                for r in &rows {
                    text.push_str(&csv_line(r, tz));
                    text.push('\n');
                }
                self.log(format!("Sent A_priority.bin ({} rows, before zstd)", rows.len()));
                Some(Outgoing { kind: Kind::Priority, name: "A_priority.bin".into(), text, payload: None })
            }
            Req::Cold => {
                if self.summary.is_empty() {
                    self.log("No biomarkers to summarize, skipped A_cold.bin".into());
                    return None;
                }
                let n = self.summary.len();
                let payload = self.cold_ccsds();
                self.log(format!("Scheduled send: A_cold.bin ({n} biomarkers, numeric + CCSDS 121, {} B)", payload.len()));
                Some(Outgoing { kind: Kind::Bulk, name: "A_cold.bin".into(), text: String::new(), payload: Some(payload) })
            }
            Req::Blocks => Some(Outgoing {
                kind: Kind::Bulk,
                name: "blocks.csv".into(),
                text: self.blocks_csv(now),
                payload: None,
            }),
        }
    }

    /// JS가 압축한 파일을 전송 기록에 올리고 대기열에 넣는다. 기록 번호를 돌려준다.
    pub fn enqueue(&mut self, kind: Kind, name: &str, size: f64) -> u32 {
        let id = self.blocks.len() as u32;
        self.blocks.push(Block {
            id,
            from: if self.cfg.is_mars { "Mars" } else { "Earth" },
            name: name.to_string(),
            size,
            started: false,
            sent_clock: 0,
            arrive_clock: 0,
            tx_end: 0,
            arrive_at: 0,
        });
        match kind {
            Kind::Priority => self.queue_prio.push_back(id),
            Kind::Bulk => self.queue_bulk.push_back(id),
        }
        id
    }

    /// 링크가 비었으면 대기열 맨 앞을 보낸다. priority가 bulk보다 항상 먼저다.
    /// 이미 나가는 중인 파일은 끊지 않고, 끝난 뒤에 다음 파일이 나간다.
    pub fn dispatch(&mut self, now: i64) -> Option<Dispatched> {
        if now < self.link_free_at {
            return None;
        }
        let (id, kind) = match self.queue_prio.pop_front() {
            Some(id) => (id, Kind::Priority),
            None => (self.queue_bulk.pop_front()?, Kind::Bulk),
        };
        let lag = self.cfg.clock_lag_ms;
        let tx_delay = self.cfg.tx_delay_ms;
        let bps = self.cfg.link_bytes_per_sec;

        let b = &mut self.blocks[id as usize];
        let tx_end = now + (b.size / bps * 1000.0) as i64;
        let arrive_at = tx_end + tx_delay;
        b.started = true;
        b.sent_clock = now - lag;
        b.arrive_clock = arrive_at - lag;
        b.tx_end = tx_end;
        b.arrive_at = arrive_at;
        let name = b.name.clone();
        self.link_free_at = tx_end;

        Some(Dispatched { block_id: id, kind, name, arrive_at })
    }

    // ---------- 출력 ----------

    /// 전송 기록 CSV (상태는 now 기준)
    pub fn blocks_csv(&self, now: i64) -> String {
        let tz = self.cfg.tz_offset_min;
        let mut out = String::from("block_id,clock,sent_at,file_name,size_bytes,status,arrive_at\n");
        for b in &self.blocks {
            let sent = if b.started { fmt_local(b.sent_clock, tz) } else { String::new() };
            let arrive = if b.started { fmt_local(b.arrive_clock, tz) } else { String::new() };
            let _ = writeln!(
                out,
                "B{:04},{},{},\"{}\",{},{},{}",
                b.id + 1,
                b.from,
                sent,
                b.name.replace('"', "\"\""),
                b.size,
                block_status(b, now),
                arrive
            );
        }
        out
    }

    /// 화면 표 전체 스냅샷 (JSON)
    pub fn snapshot(&self, now: i64) -> Value {
        let tz = self.cfg.tz_offset_min;
        let clock = self.my_clock(now);
        let clock_str = fmt_local(clock, tz);

        let hot_rows: Vec<Value> = self
            .hot
            .iter()
            .rev()
            .take(30)
            .map(|r| json!([fmt_local(r.ts, tz), r.biomarker, r.figure.to_string(), r.status]))
            .collect();

        let cold_rows: Vec<Value> = self
            .summary
            .iter()
            .map(|(n, a)| {
                json!([
                    n,
                    a.count,
                    format!("{:.2}", a.min),
                    format!("{:.2}", a.max),
                    format!("{:.2}", a.sum / a.count as f64),
                    fmt_local(a.start, tz),
                    fmt_local(a.end, tz)
                ])
            })
            .collect();

        let prio_rows: Vec<Value> = self
            .prio_all
            .iter()
            .enumerate()
            .rev()
            .take(30)
            .map(|(i, r)| {
                let state = if i < self.prio_sent { "Sent" } else { "Pending" };
                json!([fmt_local(r.ts, tz), r.biomarker, r.figure.to_string(), r.status, r.reason, state])
            })
            .collect();

        let block_rows: Vec<Value> = self
            .blocks
            .iter()
            .rev()
            .take(50)
            .map(|b| {
                json!([
                    format!("B{:04}", b.id + 1),
                    b.from,
                    if b.started { fmt_local(b.sent_clock, tz) } else { "-".into() },
                    b.name,
                    format_bytes(b.size),
                    block_status(b, now),
                    if b.started { fmt_local(b.arrive_clock, tz) } else { "-".into() }
                ])
            })
            .collect();

        json!({
            "clock": clock_str[11..].to_string(),
            "date": clock_str[..10].to_string(),
            "playing": self.playing,
            "loaded": self.rows.len(),
            "played": self.play_idx,
            "hotCount": self.hot.len(),
            "ingested": self.ingested_rows,
            "absorbed": self.absorbed_rows,
            "hotRows": hot_rows,
            "coldRows": cold_rows,
            "prioRows": prio_rows,
            "prioPending": self.prio_pending.len(),
            "prioSent": self.prio_sent,
            "prioTotal": self.prio_all.len(),
            "nextCold": fmt_local((self.last_cold_key + 1) * self.cfg.cold_every_ms, tz),
            "convLog": self.logs.iter().take(20).cloned().collect::<Vec<String>>(),
            "blocks": block_rows,
        })
    }

    /// 용량 비교용 누적 텍스트 (JS가 zstd로 압축해서 크기를 잰다). 행이 없으면 빈 문자열.
    /// A_cold.bin 내용: 바이오마커 수(2바이트, big-endian) + 숫자 열을 CCSDS 121(32비트 샘플)로 압축한 것.
    /// 받는 쪽은 바이오마커 수 × 7개 샘플을 풀면 된다. 요약이 비어 있으면 빈 바이트.
    pub fn cold_ccsds(&self) -> Vec<u8> {
        if self.summary.is_empty() {
            return Vec::new();
        }
        let mut out = (self.summary.len() as u16).to_be_bytes().to_vec();
        out.extend(ccsds::compress_samples(&self.cold_numeric(), 32));
        out
    }

    /// cold 요약을 숫자 열로 바꾼 32비트 샘플 (A_cold.bin의 CCSDS 입력).
    /// 열 단위로 이어 붙인다: 바이오마커 ID, count, min, max, mean, 시작(초), 끝(초).
    /// - ID는 이름 정렬 순서 번호. 이름 목록은 화성·지구가 미리 공유한다고 본다
    /// - min·max·mean은 0.001 단위 정수, 음수는 zigzag로 0 이상 정수로 바꾼다
    pub fn cold_numeric(&self) -> Vec<u32> {
        let milli = |v: f64| {
            let i = (v * 1000.0).round() as i32;
            ((i << 1) ^ (i >> 31)) as u32
        };
        let secs = |ms: i64| (ms.div_euclid(1000)) as u32;
        let accs: Vec<&Acc> = self.summary.values().collect();
        let mut out = Vec::with_capacity(accs.len() * 7);
        out.extend((0..accs.len() as u32).collect::<Vec<_>>());
        out.extend(accs.iter().map(|a| a.count as u32));
        out.extend(accs.iter().map(|a| milli(a.min)));
        out.extend(accs.iter().map(|a| milli(a.max)));
        out.extend(accs.iter().map(|a| milli(a.sum / a.count as f64)));
        out.extend(accs.iter().map(|a| secs(a.start)));
        out.extend(accs.iter().map(|a| secs(a.end)));
        out
    }

    pub fn size_texts(&self) -> Value {
        let hot = if self.ingested_rows == 0 {
            String::new()
        } else {
            format!("{HOT_HEADER}\n{}", self.ingested_text)
        };
        let prio = if self.prio_all.is_empty() {
            String::new()
        } else {
            format!("{HOT_HEADER}\n{}", self.prio_text)
        };
        json!({ "hot": hot, "prio": prio })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cold_numeric_has_seven_columns_per_biomarker() {
        let mut sim = Sim::new(cfg(true), 0);
        sim.load("timestamp,Biomarker,Figure,Status\n\
2026-01-01 00:00,TST,7.25,Normal\n\
2026-01-01 00:00,SE,-1.5,Normal\n\
2026-01-01 00:05,TST,6.75,Normal\n").unwrap();
        sim.set_playing(true);
        for _ in 0..5 {
            sim.play_step();
        }
        let v = sim.cold_numeric();
        assert_eq!(v.len(), 2 * 7);
        // 정렬 순서: SE, TST
        assert_eq!(&v[0..2], &[0, 1]); // ID
        assert_eq!(&v[2..4], &[1, 2]); // count
        assert_eq!(v[4], 2999); // SE min -1.5 → -1500 → zigzag 2999
        assert_eq!(v[9], 14000); // TST mean 7.0 → 7000 → zigzag 14000
    }

    #[test]
    fn cold_payload_is_numeric_ccsds_and_decodes() {
        let mut sim = Sim::new(cfg(true), 0);
        sim.load(CSV).unwrap();
        sim.set_playing(true);
        for _ in 0..20 {
            sim.play_step();
        }
        let nums = sim.cold_numeric();
        let payload = sim.cold_ccsds();
        let count = u16::from_be_bytes([payload[0], payload[1]]) as usize;
        assert_eq!(count * 7, nums.len());
        assert_eq!(ccsds::decompress_samples(&payload[2..], nums.len(), 32).unwrap(), nums);
        sim.force("cold");
        let out = sim.next_request(0).expect("A_cold 요청");
        assert_eq!(out.name, "A_cold.bin");
        assert_eq!(out.payload.as_deref(), Some(payload.as_slice()));
    }

    #[test]
    fn korean_status_values_still_work() {
        let csv = "timestamp,Biomarker,Figure,Status\n\
2026-01-01 00:00,TST,7,정상\n\
2026-01-01 00:00,SL,45,경고\n\
2026-01-01 00:00,SE,70,위험\n";
        let rows = parse_csv(csv, 0).unwrap();
        let st: Vec<&str> = rows.iter().map(|r| r.status.as_str()).collect();
        assert_eq!(st, ["Normal", "Warning", "Critical"]);
        assert_eq!(rows.iter().filter(|r| is_priority(&r.status)).count(), 2);
    }

    const TZ: i64 = 0;

    fn cfg(is_mars: bool) -> Config {
        Config {
            is_mars,
            tz_offset_min: TZ,
            clock_lag_ms: 0,
            tx_delay_ms: 22 * 60_000,
            link_bytes_per_sec: 10.0 * 1024.0,
            cold_every_ms: 3_600_000,
            prio_every_ms: 1_000,
        }
    }

    const CSV: &str = "\u{feff}timestamp,Biomarker,Figure,Status\n\
2026-01-01 00:00,TST,7,Normal\n\
2026-01-01 00:00,SL,15,Warning\n\
2026-01-01 00:00,TST,8,Normal\n\
2026-01-01 00:02,TST,9,Normal\n";

    #[test]
    fn parses_bom_and_timestamps() {
        let rows = parse_csv(CSV, TZ).unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].biomarker, "TST");
        let base = parse_ts("2026-01-01 00:00", TZ).unwrap();
        assert_eq!(rows[0].ts, base);
        assert_eq!(rows[3].ts - rows[0].ts, 120_000);
        assert_eq!(fmt_local(rows[3].ts, TZ), "2026-01-01 00:02:00");
    }

    #[test]
    fn timezone_shifts_parsed_time() {
        // 한국 시간 00:00은 UTC 전날 15:00
        let ts = parse_ts("2026-01-01 00:00", 540).unwrap();
        assert_eq!(fmt_local(ts, 540), "2026-01-01 00:00:00");
        assert_eq!(fmt_local(ts, 0), "2025-12-31 15:00:00");
    }

    #[test]
    fn context_marks_first_rows_of_anomaly_biomarkers() {
        let mut rows = parse_csv(CSV, TZ).unwrap();
        mark_context(&mut rows);
        // SL은 Warning 행이 있으니 처음 3행 맥락. SL은 1행뿐이라 그 행만.
        assert!(rows[1].ctx);
        // TST에는 이상치가 없으니 맥락 표시 없음
        assert!(!rows[0].ctx);
        assert!(!rows[2].ctx);
    }

    #[test]
    fn summary_takes_only_normal_rows() {
        let mut sim = Sim::new(cfg(true), 0);
        sim.load(CSV).unwrap();
        sim.set_playing(true);
        while sim.playing {
            sim.play_step();
        }
        // 출력이 끝나면 hot 전부 요약 반영. TST Normal 3개(7,8,9), SL은 Warning이라 요약 제외
        let snap = sim.snapshot(0);
        let cold = snap["coldRows"].as_array().unwrap();
        assert_eq!(cold.len(), 1);
        assert_eq!(cold[0][0], "TST");
        assert_eq!(cold[0][1], 3);
        assert_eq!(cold[0][2], "7.00");
        assert_eq!(cold[0][3], "9.00");
        assert_eq!(cold[0][4], "8.00");
    }

    #[test]
    fn priority_collects_anomaly_and_context_rows() {
        let mut sim = Sim::new(cfg(true), 0);
        sim.load(CSV).unwrap();
        sim.set_playing(true);
        while sim.playing {
            sim.play_step();
        }
        // SL Warning 1행 (맥락 처리는 SL 처음 3행 = 1행 전부)
        let snap = sim.snapshot(0);
        assert_eq!(snap["prioTotal"], 1);
        assert_eq!(snap["prioRows"][0][4], "Anomaly");
    }

    #[test]
    fn priority_goes_before_bulk_when_link_frees() {
        let mut sim = Sim::new(cfg(true), 0);
        let bulk = sim.enqueue(Kind::Bulk, "A_cold.bin", 1024.0);
        let prio = sim.enqueue(Kind::Priority, "A_priority.bin", 1024.0);
        let first = sim.dispatch(0).expect("링크가 비어 있음");
        assert_eq!(first.block_id, prio);
        assert_eq!(first.kind, Kind::Priority);
        // 링크가 바쁘면 아무것도 안 나간다
        assert!(sim.dispatch(1).is_none());
        let later = sim.dispatch(10_000_000).expect("링크가 비었음");
        assert_eq!(later.block_id, bulk);
    }

    #[test]
    fn hot_keeps_60_seconds_of_data_time() {
        let mut sim = Sim::new(cfg(true), 0);
        let mut csv = String::from("timestamp,Biomarker,Figure,Status\n");
        for s in 0..120 {
            csv.push_str(&format!("2026-01-01 00:{:02}:{:02},X,1,Normal\n", s / 60, s % 60));
        }
        sim.load(&csv).unwrap();
        sim.set_playing(true);
        for _ in 0..90 {
            sim.play_step();
        }
        // 마지막 출력 시각 89초 → 보관 기준 29초보다 큰 30~89초, 60행이 남음
        assert_eq!(sim.hot.len(), 60);
    }
}
