/* tslint:disable */
/* eslint-disable */

export class Sim {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * 전송 기록 CSV (blocks.csv 내용)
     */
    blocksCsv(now_ms: number): string;
    /**
     * cold 요약을 숫자 열로 바꾼 32비트 샘플 (숫자 압축 비교용)
     */
    coldNumeric(): Uint32Array;
    /**
     * 지금 보낼 수 있으면 `{blockId, kind, name, arriveAt}` JSON, 아니면 빈 문자열.
     */
    dispatch(now_ms: number): string;
    /**
     * 압축한 파일을 기록에 올리고 대기열에 넣는다. 기록 번호를 돌려준다.
     */
    enqueue(kind: string, name: string, size: number): number;
    /**
     * 버튼으로 바로 발송. kind: "priority" | "cold"
     */
    force(kind: string): void;
    /**
     * A_hot.csv 내용을 읽는다. 실패하면 오류 메시지를 던진다.
     */
    load(text: string): void;
    /**
     * `now_ms`는 Date.now(). 지구 창은 clock_lag_ms = 0, 화성 창은 22분(1_320_000)을 넘긴다.
     */
    constructor(is_mars: boolean, tz_offset_min: number, clock_lag_ms: number, tx_delay_ms: number, link_bytes_per_sec: number, cold_every_ms: number, prio_every_ms: number, now_ms: number);
    /**
     * 발송할 파일이 있으면 `{kind, name, text}` JSON, 없으면 빈 문자열.
     */
    nextRequest(now_ms: number): string;
    /**
     * 원본 1행 출력. JS의 setInterval 주기가 재생 속도다.
     */
    playStep(): void;
    reset(): void;
    setPlaying(on: boolean): void;
    /**
     * 용량 비교용 누적 텍스트 `{hot, cold, prio}` (JSON 문자열). 행이 없으면 빈 문자열 값.
     */
    sizeTexts(): string;
    /**
     * 화면 표 전체 (JSON 문자열)
     */
    snapshot(now_ms: number): string;
}

/**
 * CCSDS 121.0-B-3 무손실 압축 (용량 비교용). 바이트를 8비트 샘플로 압축한다.
 */
export function ccsds121Compress(data: Uint8Array): Uint8Array;

/**
 * CCSDS 121.0-B-3 무손실 압축. n비트(4~32) 숫자 샘플을 압축한다.
 */
export function ccsds121CompressSamples(data: Uint32Array, n: number): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_sim_free: (a: number, b: number) => void;
    readonly ccsds121Compress: (a: number, b: number) => [number, number];
    readonly ccsds121CompressSamples: (a: number, b: number, c: number) => [number, number];
    readonly sim_blocksCsv: (a: number, b: number) => [number, number];
    readonly sim_coldNumeric: (a: number) => [number, number];
    readonly sim_dispatch: (a: number, b: number) => [number, number];
    readonly sim_enqueue: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly sim_force: (a: number, b: number, c: number) => void;
    readonly sim_load: (a: number, b: number, c: number) => [number, number];
    readonly sim_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly sim_nextRequest: (a: number, b: number) => [number, number];
    readonly sim_playStep: (a: number) => void;
    readonly sim_reset: (a: number) => void;
    readonly sim_setPlaying: (a: number, b: number) => void;
    readonly sim_sizeTexts: (a: number) => [number, number];
    readonly sim_snapshot: (a: number, b: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
