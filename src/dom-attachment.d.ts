export interface SurfaceOptions {
  /** Text/image/SVG only. Re-arm after complete exit when once is false. Explicit play takes over automatic triggering. */
  revealOnView?: false | {threshold?: number; once?: boolean; root?: Element | null};
  resting?: 'mesh' | 'native';
  inputEffect?: string;
  inputEffectOptions?: {
    particleShape?: 'triangle' | 'square';
    duration?: number;
    exitEffect?: string;
    formation?: number;
    chaos?: number;
    motion?: number;
    horizontal?: number;
    vertical?: number;
    flipX?: boolean;
    flipY?: boolean;
    exitFlipX?: boolean;
    exitFlipY?: boolean;
    bounceLines?: boolean;
    seed?: number;
    recipe?: Record<string, number | boolean | string>;
  };
  divisions?: 'auto' | number;
}
export interface SurfaceState {
  disposed: boolean;
  mode: string;
  reason?: string | null;
  committed?: string | null;
  [key: string]: unknown;
}
export interface Surface {
  element: HTMLElement;
  ready: Promise<{mode: string; reason?: string | null}>;
  refresh(): void;
  update(options: Pick<SurfaceOptions, 'inputEffect' | 'inputEffectOptions' | 'resting'>): void;
  stats(): SurfaceState;
  destroy(): void;
}
export interface TextSurface extends Surface { cancel?(): void; play(phase?: 'enter' | 'exit'): void; }
export type DOMPresentation = 'local' | 'global' | 'auto';
export interface DOMInstallation {
  swapImage(previous: HTMLImageElement, next: HTMLImageElement, options?: SurfaceOptions & {exitEffect?: string | null; waitForExit?: boolean; enterEffect?: boolean; topImage?: 'previous' | 'next'; presentation?: DOMPresentation}): {finished: Promise<{status: string}>; cancel(): void};
  attachSVG(element: SVGSVGElement, options?: SurfaceOptions & {presentation?: DOMPresentation}): Omit<TextSurface, 'element'> & {element: SVGSVGElement};
  animateOnce(element: HTMLElement, options?: SurfaceOptions & {phase?: 'enter' | 'exit'; presentation?: DOMPresentation; layer?: string}): {finished: Promise<{status: string; phase: string}>; cancel(): void};
  attachImage(element: HTMLImageElement, options?: SurfaceOptions & {presentation?: DOMPresentation; layer?: string}): TextSurface;
  attachInput(element: HTMLInputElement | HTMLTextAreaElement, options?: SurfaceOptions & {host?: HTMLElement; presentation?: DOMPresentation; layer?: string}): Surface;
  attachText(element: HTMLElement, options?: SurfaceOptions & {presentation?: DOMPresentation; layer?: string}): TextSurface;
  registerLayer(name: string, options: {root: HTMLDialogElement; zIndex?: number}): void;
  unregisterLayer(name: string): void;
  /** Manual transfer preserving the native editor, scene and effect timeline. */
  transfer(surface: Surface, destination?: {presentation?: DOMPresentation; layer?: string | null}): void;
  routing(surface: Surface): {requested: DOMPresentation; presentation: 'local' | 'global'; layer: string | null; reason: string; pending: boolean; error: string | null};
  refresh(): void;
  stats(): {disposed: boolean; controls: number; contexts: number; copies: number; owners: Partial<Record<string, ReturnType<DOMRenderer['stats']>>>};
  destroy(): void;
}
/** Explicit or bounded automatic routing; existing native editors remain owned by the host. */
export function createDOMInstallation(THREE: Parameters<typeof createDOMRenderer>[0], document: Document, options?: {presentation?: DOMPresentation; documentCanvas?: boolean; escapeEffects?: boolean; zIndex?: number}): DOMInstallation;
export interface DOMRenderer {
  attachSVG(element: SVGSVGElement, options?: SurfaceOptions): Omit<TextSurface, 'element'> & {element: SVGSVGElement};
  attachImage(element: HTMLImageElement, options?: SurfaceOptions): TextSurface;
  readonly domElement: HTMLCanvasElement | null;
  /** Refresh all attached surfaces after external layout/value changes. */
  refresh(): void;
  attachText(element: HTMLElement, options?: SurfaceOptions): TextSurface;
  attachInput(element: HTMLInputElement | HTMLTextAreaElement, options?: SurfaceOptions & {host?: HTMLElement}): Surface;
  stats(): {disposed: boolean; lost: boolean; contexts: number; controls: number; leases: number; [key: string]: unknown};
  destroy(): void;
}
/** THREE is injected: the host retains its existing Three.js dependency. */
export function createDOMRenderer(THREE: {WebGLRenderer: new (...args: any[]) => any; [key: string]: any}, document: Document, options?: {presentation?: 'local' | 'viewport'; escapeEffects?: boolean; zIndex?: number; root?: HTMLDialogElement}): DOMRenderer;






