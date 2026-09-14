import type {DOMPresentation, DOMInstallation, createDOMRenderer} from './dom-attachment.js';
export interface AutoRevealOptions {
  textSelector?: string;
  imageSelector?: string;
  presentation?: DOMPresentation;
  threshold?: number;
  once?: boolean;
  intersectionRoot?: Element | null;
}
/** Explicit scan. Call refresh after route/content changes; destroy on unmount. */
export function createAutoReveal(THREE: Parameters<typeof createDOMRenderer>[0], root?: Document | Element, options?: AutoRevealOptions): {

  refresh(): void;
  stats(): {disposed: boolean; attached: number; failures: {element: Element; message: string}[]; renderer: ReturnType<DOMInstallation['stats']>};
  destroy(): void;
};

