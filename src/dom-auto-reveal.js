import {createDOMInstallation} from './dom-attachment.js';

// Explicit initialization; importing this module never changes the page.
export function createAutoReveal(THREE, root = document, options = {}, sharedOwner = null) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const textSelector = options.textSelector ?? 'h1,h2,[data-thd-text]';
  const imageSelector = options.imageSelector ?? 'img[data-thd-image]';
  const exclude = '[data-thd-ignore],nav,dialog,[role="dialog"],button,a,[contenteditable]:not([contenteditable="false"])';
  // Validate selectors before allocating render resources.
  root.querySelectorAll(textSelector); root.querySelectorAll(imageSelector);
  if (options.threshold !== undefined && (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1)) throw TypeError('Invalid threshold');
  if (options.once !== undefined && typeof options.once !== 'boolean') throw TypeError('Invalid once');
  if (options.intersectionRoot != null && (options.intersectionRoot.nodeType !== 1 || options.intersectionRoot.ownerDocument !== doc)) throw TypeError('Invalid intersection root');
  const owner = sharedOwner ?? createDOMInstallation(THREE, doc, {presentation: options.presentation ?? 'auto'});
  const entries = new Map();
  let disposed = false, failures = [];
  const settings = {
    resting: 'native',
    inputEffect: 'dust-wind',
    inputEffectOptions: {duration: 2000, particleShape: 'triangle'},
    revealOnView: {threshold: options.threshold ?? 0, once: options.once ?? true, root: options.intersectionRoot ?? null}
  };
  function refresh() {
    if (disposed) throw Error('Auto reveal disposed');
    failures = [];
    const candidates = [...root.querySelectorAll(`${textSelector},${imageSelector}`)];
    if (root.nodeType === 1 && root.matches(`${textSelector},${imageSelector}`)) candidates.unshift(root);
    const hasForeignContent=el=>[...el.querySelectorAll('input,textarea,button,select,[contenteditable],img,svg,canvas')].some(node=>
      !node.closest('[data-thd-viewport-anchor],[data-thd-text-surface]'));
    const eligible = candidates.filter(el => !el.closest(exclude) && !hasForeignContent(el) && (el.matches(imageSelector) ? el.tagName === 'IMG' : !!el.textContent.trim()));
    // Attach outer text once; never mask overlapping parent/child surfaces.
    const targets = eligible.filter(el => !eligible.some(parent => parent !== el && parent.contains(el)));
    for (const [el, surface] of entries) if (!targets.includes(el)) { surface.destroy(); entries.delete(el); }
    for (const el of targets) {
      if (entries.has(el)) continue;
      try {
        entries.set(el, el.tagName === 'IMG'
          ? owner.attachImage(el, {...settings, inputEffect: 'drifting-snow'})
          : owner.attachText(el, settings));
      } catch (error) { failures.push({element: el, message: String(error.message || error)}); }
    }
    // Offscreen surfaces prepare lazily; scanning must not wait for intersection.
  }
  const api = {
    refresh,
    stats: () => ({disposed, attached: entries.size, failures: [...failures], renderer: owner.stats()}),
    destroy() { if (disposed) return; disposed = true; if(sharedOwner){for(const surface of entries.values())surface.destroy();}else owner.destroy(); entries.clear(); }
  };
  refresh();
  return api;
}


