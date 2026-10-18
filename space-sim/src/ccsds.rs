//! CCSDS 121.0-B-3 무손실 압축 (Adaptive Entropy Coder, Rice 부호화).
//! 우주 탐사선이 측정값 스트림을 보낼 때 쓰는 표준 방식이다. 샘플 폭 n은 1~32비트.
//! space-sim은 A_cold 요약 숫자 열을 32비트 샘플로 압축해서 보낸다 (`compress_samples(.., 32)`).
//!
//! 구성
//! - 전처리: 바로 앞 샘플로 예측(unit-delay predictor) → 예측 오차를 0 이상 정수로 매핑
//! - 블록(J=16샘플)마다 가장 짧아지는 부호화 방식을 골라 ID를 붙인다
//!   (ID 길이: n≤8 → 3비트, n≤16 → 4비트, n≤32 → 5비트)
//!   - 0…0+0 Zero-Block: 모두 0인 블록이 이어지면 개수만 보낸다 (64블록 세그먼트 단위, ROS 포함)
//!   - 0…0+1 Second-Extension: 두 샘플을 묶어 하나의 값으로 FS 부호화
//!   - 0…01 Fundamental Sequence (k=0), 그다음 Split-Sample k=1~(n-3), 1…1 무압축
//! - 기준 샘플: 128블록(2048샘플)마다 원본 샘플 하나를 그대로 넣어 오류가 퍼지지 않게 한다
//!
//! 이 부호기는 기준 블록을 Zero-Block으로 묶지 않는다 (표준이 허용하는 부호기 선택).
//! 마지막 블록은 직전 샘플로 채워 J개를 맞추고, 복호기는 원래 길이만큼 잘라 쓴다.

const J: usize = 16;
const SEGMENT_BLOCKS: usize = 64;
const REF_INTERVAL_BLOCKS: usize = 128;
/// Second-Extension은 두 값의 합이 이보다 크면 절대 유리하지 않으므로 계산하지 않는다
const SECOND_EXT_LIMIT: u64 = 1 << 16;

/// 샘플 폭에 따른 부호화 상수
#[derive(Clone, Copy)]
struct Params {
    n: u32,
    id_bits: u32,
    max_k: u32,
    xmax: i64,
}

impl Params {
    fn new(n: u32) -> Params {
        assert!((4..=32).contains(&n), "CCSDS 121 sample width must be 4..=32 bits");
        let id_bits = if n <= 8 { 3 } else if n <= 16 { 4 } else { 5 };
        Params { n, id_bits, max_k: ((1 << id_bits) - 3).min(n - 3), xmax: (1i64 << n) - 1 }
    }
    fn no_comp_id(self) -> u32 {
        (1 << self.id_bits) - 1
    }
}

// ---------- 비트 입출력 ----------

struct BitWriter {
    out: Vec<u8>,
    acc: u8,
    used: u32,
}

impl BitWriter {
    fn new() -> Self {
        BitWriter { out: Vec::new(), acc: 0, used: 0 }
    }
    fn bit(&mut self, b: bool) {
        self.acc = (self.acc << 1) | b as u8;
        self.used += 1;
        if self.used == 8 {
            self.out.push(self.acc);
            self.acc = 0;
            self.used = 0;
        }
    }
    fn bits(&mut self, value: u32, n: u32) {
        for i in (0..n).rev() {
            self.bit((value >> i) & 1 == 1);
        }
    }
    /// Fundamental Sequence 부호: value개의 0 다음 1
    fn fs(&mut self, value: u64) {
        for _ in 0..value {
            self.bit(false);
        }
        self.bit(true);
    }
    fn finish(mut self) -> Vec<u8> {
        if self.used > 0 {
            self.acc <<= 8 - self.used;
            self.out.push(self.acc);
        }
        self.out
    }
}

#[cfg(test)]
struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
}

#[cfg(test)]
impl<'a> BitReader<'a> {
    fn bit(&mut self) -> Result<bool, String> {
        let byte = *self.data.get(self.pos / 8).ok_or("CCSDS stream ended early")?;
        let b = (byte >> (7 - self.pos % 8)) & 1 == 1;
        self.pos += 1;
        Ok(b)
    }
    fn bits(&mut self, n: u32) -> Result<u32, String> {
        let mut v: u64 = 0;
        for _ in 0..n {
            v = (v << 1) | self.bit()? as u64;
        }
        Ok(v as u32)
    }
    fn fs(&mut self) -> Result<u64, String> {
        let mut zeros = 0;
        while !self.bit()? {
            zeros += 1;
        }
        Ok(zeros)
    }
}

// ---------- 전처리 (예측 오차 매핑) ----------

fn map_residual(x: i64, pred: i64, xmax: i64) -> u32 {
    let delta = x - pred;
    let theta = pred.min(xmax - pred);
    let m = if (0..=theta).contains(&delta) {
        2 * delta
    } else if (-theta..0).contains(&delta) {
        2 * delta.abs() - 1
    } else {
        theta + delta.abs()
    };
    m as u32
}

#[cfg(test)]
fn unmap_residual(d: u32, pred: i64, xmax: i64) -> i64 {
    let d = d as i64;
    let theta = pred.min(xmax - pred);
    if d <= 2 * theta {
        if d % 2 == 0 { pred + d / 2 } else { pred - (d + 1) / 2 }
    } else if theta == pred {
        // 예측값이 0 쪽에 붙어 있으면 큰 오차는 양수 방향뿐이다
        pred + (d - theta)
    } else {
        pred - (d - theta)
    }
}

// ---------- 블록 부호화 ----------

/// 블록 하나의 부호화 방식. 비트 수가 가장 적은 것을 고른다.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Opt {
    SecondExt,
    Split(u32), // 0 = Fundamental Sequence
    NoComp,
}

/// 두 샘플씩 묶은 값. 합이 너무 크면 None (이 블록에는 쓰지 않는다)
fn second_ext_values(d: &[u32], has_ref: bool) -> Option<Vec<u64>> {
    // 기준 블록은 첫 칸을 0으로 보고 짝을 맞춘다
    let mut s: Vec<u64> = Vec::with_capacity(J);
    if has_ref {
        s.push(0);
    }
    s.extend(d.iter().map(|&v| v as u64));
    s.chunks(2)
        .map(|p| {
            let (a, b) = (p[0], p[1]);
            (a + b <= SECOND_EXT_LIMIT).then(|| (a + b) * (a + b + 1) / 2 + b)
        })
        .collect()
}

fn opt_bits(opt: Opt, d: &[u32], has_ref: bool, p: Params) -> u64 {
    match opt {
        Opt::NoComp => d.len() as u64 * p.n as u64,
        Opt::Split(k) => d.iter().map(|&v| (v >> k) as u64 + 1 + k as u64).sum(),
        Opt::SecondExt => match second_ext_values(d, has_ref) {
            Some(g) => 1 + g.iter().map(|&x| x + 1).sum::<u64>(),
            None => u64::MAX,
        },
    }
}

fn best_opt(d: &[u32], has_ref: bool, p: Params) -> Opt {
    let mut best = Opt::NoComp;
    let mut best_bits = opt_bits(best, d, has_ref, p);
    let candidates = std::iter::once(Opt::SecondExt).chain((0..=p.max_k).map(Opt::Split));
    for opt in candidates {
        let bits = opt_bits(opt, d, has_ref, p);
        if bits < best_bits {
            best = opt;
            best_bits = bits;
        }
    }
    best
}

fn write_block(w: &mut BitWriter, opt: Opt, d: &[u32], reference: Option<u32>, p: Params) {
    match opt {
        Opt::NoComp => w.bits(p.no_comp_id(), p.id_bits),
        Opt::Split(k) => w.bits(k + 1, p.id_bits),
        Opt::SecondExt => {
            w.bits(0, p.id_bits);
            w.bit(true);
        }
    }
    if let Some(r) = reference {
        w.bits(r, p.n);
    }
    match opt {
        Opt::NoComp => d.iter().for_each(|&v| w.bits(v, p.n)),
        Opt::Split(k) => {
            d.iter().for_each(|&v| w.fs((v >> k) as u64));
            d.iter().for_each(|&v| w.bits(v & ((1u64 << k) - 1) as u32, k));
        }
        Opt::SecondExt => second_ext_values(d, reference.is_some())
            .expect("best_opt가 고른 경우에만 호출")
            .iter()
            .for_each(|&g| w.fs(g)),
    }
}

/// n비트 부호 없는 샘플 열을 CCSDS 121 비트 스트림으로 압축한다.
pub fn compress_samples(data: &[u32], n: u32) -> Vec<u8> {
    let p = Params::new(n);
    let mut w = BitWriter::new();
    if data.is_empty() {
        return w.finish();
    }
    debug_assert!(data.iter().all(|&x| x as i64 <= p.xmax), "sample wider than n bits");
    // 마지막 블록은 직전 샘플로 채워 매핑 값이 0이 되게 한다
    let mut samples = data.to_vec();
    let last = *samples.last().expect("비어 있지 않음");
    while samples.len() % J != 0 {
        samples.push(last);
    }

    // 블록별 매핑 값 (기준 블록은 첫 샘플이 기준값이라 J-1개)
    let blocks: Vec<(Option<u32>, Vec<u32>)> = samples
        .chunks(J)
        .enumerate()
        .map(|(b, chunk)| {
            let is_ref = b % REF_INTERVAL_BLOCKS == 0;
            let mut pred = if is_ref { chunk[0] as i64 } else { samples[b * J - 1] as i64 };
            let start = if is_ref { 1 } else { 0 };
            let d = chunk[start..]
                .iter()
                .map(|&x| {
                    let m = map_residual(x as i64, pred, p.xmax);
                    pred = x as i64;
                    m
                })
                .collect();
            (is_ref.then_some(chunk[0]), d)
        })
        .collect();

    let mut b = 0;
    while b < blocks.len() {
        let (reference, d) = &blocks[b];
        let zero = |i: usize| blocks[i].0.is_none() && blocks[i].1.iter().all(|&v| v == 0);
        if zero(b) {
            // 같은 세그먼트 안에서 이어지는 0 블록 수를 센다
            let seg_end = ((b / SEGMENT_BLOCKS + 1) * SEGMENT_BLOCKS).min(blocks.len());
            let mut run = 1;
            while b + run < seg_end && zero(b + run) {
                run += 1;
            }
            w.bits(0, p.id_bits);
            w.bit(false);
            if b + run == seg_end && run >= 5 {
                w.fs(4); // ROS: 세그먼트 끝까지 전부 0
            } else if run <= 4 {
                w.fs(run as u64 - 1);
            } else {
                w.fs(run as u64);
            }
            b += run;
            continue;
        }
        let opt = best_opt(d, reference.is_some(), p);
        write_block(&mut w, opt, d, *reference, p);
        b += 1;
    }
    w.finish()
}

/// 바이트 열을 8비트 샘플로 압축한다 (테스트용).
#[cfg(test)]
pub fn compress(data: &[u8]) -> Vec<u8> {
    let samples: Vec<u32> = data.iter().map(|&b| b as u32).collect();
    compress_samples(&samples, 8)
}

/// 압축을 풀어 원래 길이 `len`만큼 돌려준다 (테스트에서 왕복 검증용).
#[cfg(test)]
pub fn decompress_samples(stream: &[u8], len: usize, n: u32) -> Result<Vec<u32>, String> {
    let p = Params::new(n);
    let mut r = BitReader { data: stream, pos: 0 };
    let total_blocks = len.div_ceil(J);
    let mut out: Vec<u32> = Vec::with_capacity(total_blocks * J);
    let mut b = 0;
    while b < total_blocks {
        let is_ref = b % REF_INTERVAL_BLOCKS == 0;
        let id = r.bits(p.id_bits)?;
        if id == 0 && !r.bit()? {
            // Zero-Block
            let seg_end = ((b / SEGMENT_BLOCKS + 1) * SEGMENT_BLOCKS).min(total_blocks);
            let v = r.fs()? as usize;
            let run = match v {
                0..=3 => v + 1,
                4 => seg_end - b,
                _ => v,
            };
            let prev = *out.last().ok_or("Zero-Block cannot start the stream")?;
            out.extend(std::iter::repeat(prev).take(run * J));
            b += run;
            continue;
        }
        let reference = if is_ref { Some(r.bits(p.n)?) } else { None };
        let count = if is_ref { J - 1 } else { J };
        let d: Vec<u32> = if id == 0 {
            // Second-Extension (ID 비트 뒤 1): γ = (a+b)(a+b+1)/2 + b 를 되돌린다
            let mut vals = Vec::with_capacity(J);
            for _ in 0..J / 2 {
                let g = r.fs()?;
                let mut s: u64 = 0;
                while (s + 1) * (s + 2) / 2 <= g {
                    s += 1;
                }
                let bb = g - s * (s + 1) / 2;
                vals.push((s - bb) as u32);
                vals.push(bb as u32);
            }
            if is_ref { vals[1..].to_vec() } else { vals }
        } else if id == p.no_comp_id() {
            (0..count).map(|_| r.bits(p.n)).collect::<Result<_, _>>()?
        } else {
            let k = id - 1;
            let high: Vec<u64> = (0..count).map(|_| r.fs()).collect::<Result<_, _>>()?;
            let mut vals = Vec::with_capacity(count);
            for h in high {
                vals.push(((h << k) | r.bits(k)? as u64) as u32);
            }
            vals
        };
        let mut pred = match reference {
            Some(x) => {
                out.push(x);
                x as i64
            }
            None => *out.last().ok_or("Missing reference sample")? as i64,
        };
        for m in d {
            let x = unmap_residual(m, pred, p.xmax);
            if !(0..=p.xmax).contains(&x) {
                return Err("Corrupt CCSDS stream".into());
            }
            out.push(x as u32);
            pred = x;
        }
        b += 1;
    }
    out.truncate(len);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(data: &[u8]) -> usize {
        let packed = compress(data);
        let back = decompress_samples(&packed, data.len(), 8).unwrap();
        assert_eq!(back, data.iter().map(|&b| b as u32).collect::<Vec<_>>());
        packed.len()
    }

    fn roundtrip_n(data: &[u32], n: u32) -> usize {
        let packed = compress_samples(data, n);
        assert_eq!(decompress_samples(&packed, data.len(), n).unwrap(), data);
        packed.len()
    }

    fn xorshift(seed: u32) -> impl FnMut() -> u32 {
        let mut s = seed;
        move || {
            s ^= s << 13;
            s ^= s >> 17;
            s ^= s << 5;
            s
        }
    }

    #[test]
    fn residual_mapping_is_reversible() {
        let xmax = 255;
        for pred in 0..=xmax {
            let mut seen = std::collections::HashSet::new();
            for x in 0..=xmax {
                let m = map_residual(x, pred, xmax);
                assert!(m as i64 <= xmax);
                assert!(seen.insert(m), "pred {pred}: {m} 중복");
                assert_eq!(unmap_residual(m, pred, xmax), x);
            }
        }
        // 32비트 끝값
        let xmax = u32::MAX as i64;
        for (x, pred) in [(0, xmax), (xmax, 0), (xmax, xmax), (0, 0), (12345, 99999)] {
            assert_eq!(unmap_residual(map_residual(x, pred, xmax), pred, xmax), x);
        }
    }

    #[test]
    fn roundtrips_edge_cases() {
        roundtrip(b"");
        roundtrip(b"A");
        roundtrip(&[0u8; 15]);
        roundtrip(&[255u8; 17]);
        roundtrip(&(0..=255u8).collect::<Vec<_>>());
        roundtrip_n(&[u32::MAX, 0, u32::MAX, 0, 1], 32);
        roundtrip_n(&[65535, 0, 32768], 16);
    }

    #[test]
    fn roundtrips_random_bytes() {
        let mut rng = xorshift(0x1234_5678);
        let data: Vec<u8> = (0..20_000).map(|_| (rng() >> 24) as u8).collect();
        let size = roundtrip(&data);
        // 무작위 데이터는 줄지 않지만 무압축 옵션 덕분에 거의 늘지도 않는다
        assert!(size <= data.len() + data.len() / 30);
    }

    #[test]
    fn roundtrips_random_wide_samples() {
        let mut rng = xorshift(0x9e37_79b9);
        let wide: Vec<u32> = (0..5_000).map(|_| rng()).collect();
        roundtrip_n(&wide, 32);
        let mid: Vec<u32> = (0..5_000).map(|_| rng() & 0xffff).collect();
        roundtrip_n(&mid, 16);
        // 천천히 변하는 측정값은 크게 줄어든다
        let slow: Vec<u32> = (0..5_000).map(|i| 1_700_000_000 + i * 60 + (rng() % 3)).collect();
        let size = roundtrip_n(&slow, 32);
        assert!(size < slow.len() * 4 / 3, "{size} bytes");
    }

    #[test]
    fn long_zero_runs_use_zero_block_and_ros() {
        // 기준 블록 뒤로 같은 값이 길게 이어지면 Zero-Block으로 몇 바이트에 끝난다
        let data = vec![42u8; J * REF_INTERVAL_BLOCKS * 3 + 5];
        let size = roundtrip(&data);
        assert!(size < 40, "{size} bytes");
    }

    #[test]
    fn compresses_csv_text() {
        let mut text = String::from("Biomarker,count,min,max,mean,start_timestamp,end_timestamp\n");
        for i in 0..200 {
            text.push_str(&format!("TST,{},6.1,8.4,7.2{},2026-10-01 07:00:00,2026-10-18 07:00:00\n", i + 1, i % 10));
        }
        let size = roundtrip(text.as_bytes());
        assert!(size < text.len(), "{size} >= {}", text.len());
    }
}
