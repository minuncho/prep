# space-sim (Rust)

화성 ↔ 지구 통신 시뮬레이터. 로직은 Rust(WebAssembly), 화면은 HTML/JS.

## 구성

| 파일 | 역할 |
|---|---|
| `src/sim.rs` | 순수 로직: CSV 파싱, 재생, 보관(60초), 요약(Normal 행 O(1)), priority 선별, 전송 대기열, blocks.csv |
| `src/ccsds.rs` | CCSDS 121.0-B-3 무손실 압축 (Rice 부호화, 4~32비트 샘플). A_cold를 숫자 열로 압축한다 |
| `src/lib.rs` | 브라우저 바인딩 (`Sim` 클래스) |
| `web/index.html` | 화면 구조와 스타일 |
| `web/app.js` | 화면 그리기, 파일 불러오기, 창 간 메시지, zstd 압축 (hot·priority) |
| `web/pkg/` | wasm-bindgen으로 만든 결과물 (커밋해 둠) |

전송 파일 형식

- A_priority.bin: 원본 CSV 행 + zstd
- A_cold.bin: 바이오마커 수(2바이트, big-endian) + 요약 숫자 열을 CCSDS 121(32비트 샘플)로 압축한 것.
  열은 바이오마커 ID(이름 정렬 순서, 이름 목록은 양쪽이 미리 공유), count, min, max, mean(0.001 단위, zigzag), 시작·끝 시각(초) 순서로 이어 붙인다.

zstd 압축은 JS가 맡는다. 압축 라이브러리가 Rust에서 wasm으로 잘 빌드되지 않아서 JS 쪽(`@bokuweb/zstd-wasm`)을 쓴다.

## 테스트

```bash
cargo test
```

## 빌드

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked
cargo build --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir web/pkg target/wasm32-unknown-unknown/release/space_sim.wasm
```

## 공유 링크 (GitHub Pages)

- 지구 창: https://minuncho.github.io/prep/space-sim/web/index.html?side=earth
- 화성 창: https://minuncho.github.io/prep/space-sim/web/index.html?side=mars

`main`에 푸시하면 1분쯤 뒤 반영된다. 두 창은 같은 브라우저에서 열어야 서로 통신한다.

## 로컬 실행

```bash
cd web
python3 -m http.server 8080
```

- 지구 창: http://localhost:8080/index.html?side=earth
- 화성 창: http://localhost:8080/index.html?side=mars

두 창은 같은 브라우저, 같은 주소에서 BroadcastChannel로 통신한다.
