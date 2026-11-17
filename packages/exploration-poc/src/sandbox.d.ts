declare module 'codetour-exploration-sandbox' {
  export function runScript(options: { workspace: string; code: string; params?: object; timeoutMs?: number; signal?: AbortSignal; scripts?: Record<string, string>; strict?: boolean; includeTrace?: boolean }): Promise<any>;
}
