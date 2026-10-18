//! 브라우저(WebAssembly) 바인딩. 실제 로직은 sim.rs에 있다.
//! JS는 이 파일이 내보내는 `Sim`을 호출하고, 화면 그리기와 zstd 압축(hot·priority)을 맡는다.
//! A_cold는 Rust가 숫자 열 + CCSDS 121로 직접 압축해서 넘긴다.

mod ccsds;
mod sim;

use serde_json::json;
use sim::{Config, Kind, Sim as Core};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Sim {
    core: Core,
}

#[wasm_bindgen]
impl Sim {
    /// `now_ms`는 Date.now(). 지구 창은 clock_lag_ms = 0, 화성 창은 22분(1_320_000)을 넘긴다.
    #[wasm_bindgen(constructor)]
    pub fn new(
        is_mars: bool,
        tz_offset_min: i32,
        clock_lag_ms: f64,
        tx_delay_ms: f64,
        link_bytes_per_sec: f64,
        cold_every_ms: f64,
        prio_every_ms: f64,
        now_ms: f64,
    ) -> Sim {
        let cfg = Config {
            is_mars,
            tz_offset_min: tz_offset_min as i64,
            clock_lag_ms: clock_lag_ms as i64,
            tx_delay_ms: tx_delay_ms as i64,
            link_bytes_per_sec,
            cold_every_ms: cold_every_ms as i64,
            prio_every_ms: prio_every_ms as i64,
        };
        Sim { core: Core::new(cfg, now_ms as i64) }
    }

    /// A_hot.csv 내용을 읽는다. 실패하면 오류 메시지를 던진다.
    pub fn load(&mut self, text: &str) -> Result<(), JsError> {
        self.core.load(text).map_err(|e| JsError::new(&e))
    }

    pub fn reset(&mut self) {
        self.core.reset();
    }

    #[wasm_bindgen(js_name = setPlaying)]
    pub fn set_playing(&mut self, on: bool) {
        self.core.set_playing(on);
    }

    /// 원본 1행 출력. JS의 setInterval 주기가 재생 속도다.
    #[wasm_bindgen(js_name = playStep)]
    pub fn play_step(&mut self) {
        self.core.play_step();
    }

    /// 발송할 파일이 있으면 `{kind, name, encoding, text, bytes}` JSON, 없으면 빈 문자열.
    /// encoding이 "zstd"면 JS가 text를 압축하고, "ccsds121"이면 bytes를 그대로 보낸다.
    #[wasm_bindgen(js_name = nextRequest)]
    pub fn next_request(&mut self, now_ms: f64) -> String {
        match self.core.next_request(now_ms as i64) {
            Some(out) => json!({
                "kind": out.kind.as_str(),
                "name": out.name,
                "encoding": if out.payload.is_some() { "ccsds121" } else { "zstd" },
                "text": out.text,
                "bytes": out.payload,
            })
            .to_string(),
            None => String::new(),
        }
    }

    /// 버튼으로 바로 발송. kind: "priority" | "cold"
    pub fn force(&mut self, kind: &str) {
        self.core.force(kind);
    }

    /// 압축한 파일을 기록에 올리고 대기열에 넣는다. 기록 번호를 돌려준다.
    pub fn enqueue(&mut self, kind: &str, name: &str, size: f64) -> u32 {
        let k = Kind::parse(kind).unwrap_or(Kind::Bulk);
        self.core.enqueue(k, name, size)
    }

    /// 지금 보낼 수 있으면 `{blockId, kind, name, arriveAt}` JSON, 아니면 빈 문자열.
    pub fn dispatch(&mut self, now_ms: f64) -> String {
        match self.core.dispatch(now_ms as i64) {
            Some(d) => json!({
                "blockId": d.block_id,
                "kind": d.kind.as_str(),
                "name": d.name,
                "arriveAt": d.arrive_at,
            })
            .to_string(),
            None => String::new(),
        }
    }

    /// 전송 기록 CSV (blocks.csv 내용)
    #[wasm_bindgen(js_name = blocksCsv)]
    pub fn blocks_csv(&self, now_ms: f64) -> String {
        self.core.blocks_csv(now_ms as i64)
    }

    /// 화면 표 전체 (JSON 문자열)
    pub fn snapshot(&self, now_ms: f64) -> String {
        self.core.snapshot(now_ms as i64).to_string()
    }

    /// 지금 요약으로 만든 A_cold.bin 바이트 (숫자 열 + CCSDS 121). 용량 표시용
    #[wasm_bindgen(js_name = coldPayload)]
    pub fn cold_payload(&self) -> Vec<u8> {
        self.core.cold_ccsds()
    }

    /// 용량 비교용 누적 텍스트 `{hot, prio}` (JSON 문자열). 행이 없으면 빈 문자열 값.
    #[wasm_bindgen(js_name = sizeTexts)]
    pub fn size_texts(&self) -> String {
        self.core.size_texts().to_string()
    }
}
