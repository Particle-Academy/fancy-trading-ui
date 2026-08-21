/**
 * Minimal Node declarations for the tests that read the source tree.
 *
 * `@types/node` is deliberately NOT a dependency here, matching every other
 * React package in the suite. Pulling it in would put Node's globals into
 * `src/`'s type environment, where a stray `process` or `Buffer` would then
 * typecheck clean and fail in a browser. Only the tests need `fs`, and only
 * these four functions, so only these four are declared.
 */

declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function statSync(path: string): { isDirectory(): boolean };
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
}

/**
 * Node 22 exposes this on ESM modules; TypeScript only declares it when
 * `@types/node` is present, which — see above — it deliberately is not.
 */
interface ImportMeta {
  readonly dirname: string;
}
