# space-sim (Rust)

화성 ↔ 지구 통신 시뮬레이터. 로직은 Rust(WebAssembly), 화면은 HTML/JS.

## 구성

| 파일 | 역할 |
|---|---|
| `src/sim.rs` | 순수 로직: CSV 파싱, 재생, 보관(60초), 요약(정상 행 O(1)), priority 선별, 전송 대기열, blocks.csv |
| `src/lib.rs` | 브라우저 바인딩 (`Sim` 클래스) |
| `web/index.html` | 화면 구조와 스타일 |
| `web/app.js` | 화면 그리기, 파일 불러오기, 창 간 메시지, zstd 압축 |
| `web/pkg/` | wasm-bindgen으로 만든 결과물 (커밋해 둠) |

JS는 zstd 압축만 맡는다. 압축 라이브러리가 Rust에서 wasm으로 잘 빌드되지 않아서 JS 쪽(`@bokuweb/zstd-wasm`)을 쓴다.

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

## 실행

```bash
cd web
python3 -m http.server 8080
```

- 지구 창: http://localhost:8080/index.html?side=earth
- 화성 창: http://localhost:8080/index.html?side=mars

두 창은 같은 브라우저, 같은 주소에서 BroadcastChannel로 통신한다.
