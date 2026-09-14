import type {createFree,FREE_EFFECTS} from './dom-free.js';
export interface FreeLoaderOptions {
  auto?: boolean;
  document?: Document;
  THREE?: Parameters<typeof createFree>[0];
}
export interface FreeLoaderAPI {
  create(root?: Document|Element,options?: Parameters<typeof createFree>[2]):ReturnType<typeof createFree>;
  effects: typeof FREE_EFFECTS;
  readonly instance?: ReturnType<typeof createFree>;
}
/** Browser initialization; imports are inert. Repeated calls reuse the first initialization. */
export function loadFree(options?:FreeLoaderOptions):Promise<Readonly<FreeLoaderAPI>>;
