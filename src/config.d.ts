/**
 * Types for `config.js`.
 *
 * The module is JavaScript so that Node's type-stripping — which handles `.ts`
 * modules only — can load it. This file gives TypeScript the shape.
 */
export declare function buildConfigSchema(z: unknown): unknown
export declare function loadConfigSchema(): Promise<unknown>
