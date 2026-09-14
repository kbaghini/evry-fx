import type {AutoRevealOptions} from './dom-auto-reveal.js';
import type {DOMPresentation, SurfaceOptions, TextSurface, createDOMRenderer} from './dom-attachment.js';
export const FREE_EFFECTS: Readonly<{textEnter:'dust-wind';textExit:'smoke';imageEnter:'drifting-snow';imageExit:'melt'}>;
export type FreeSurface = Pick<TextSurface,'ready'|'play'|'refresh'|'stats'|'destroy'> & {cancel():void};
export interface FreeAttachOptions {revealOnView?: SurfaceOptions['revealOnView'];presentation?: DOMPresentation;}
export function createFree(THREE: Parameters<typeof createDOMRenderer>[0],root?: Document|Element,options?: AutoRevealOptions & {auto?:boolean;zIndex?:number;documentCanvas?:boolean;experimentalDocumentCanvas?:boolean}): {
  attachText(element:HTMLElement,options?:FreeAttachOptions):FreeSurface;
  attachImage(element:HTMLImageElement,options?:FreeAttachOptions):FreeSurface;
  attachSVG(element:SVGSVGElement,options?:FreeAttachOptions):FreeSurface;
  swapImage(previous:HTMLImageElement,next:HTMLImageElement,options?:{exit?:boolean;waitForExit?:boolean;presentation?:DOMPresentation}):{finished:Promise<{status:string}>;cancel():void};
  refresh():void;
  stats():{disposed:boolean;automatic:unknown;renderer:unknown};
  destroy():void;
};


