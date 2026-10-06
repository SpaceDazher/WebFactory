// Минимальные объявления Node для typecheck (проект без @types/node)
declare module 'fs' { const fs: any; export default fs; }
declare module 'zlib' { export function deflateSync(b: any, o?: any): any; export function inflateSync(b: any): any; export function gzipSync(b: any): any; export function gunzipSync(b: any): any; }
declare const process: any;
declare const Buffer: any;
declare module 'path' { const path: any; export default path; }
declare module 'child_process' { export function spawnSync(cmd: string, args?: string[], o?: any): any; export function spawn(cmd: string, args?: string[], o?: any): any; }
