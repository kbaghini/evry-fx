# EV-RY FX Free 0.1.0-rc.3

- Cancel/update no longer starts a fresh text handoff; invalid play phases leave automatic reveal intact, and offscreen no-effect calls complete immediately.
- Image/SVG source refresh preserves the active effect clock, seed and settled exit mask. SVG snapshot errors retain native fallback diagnostics.
- SVG native pixels now appear below the settled mesh during the same 250ms handoff as images.
- Cancelling an image swap restores the incoming image's original location, including removal when it was initially detached.
- Completion waits share one pending poller, cancel promptly on superseding play or owner disposal, and do not time out untouched intersection reveals.
- Public whenFinished() for completion, cancellation and unsupported rendering.
- Offscreen text preserves its effect clock without particle updates or drawing; plain/rich text resumes at elapsed time and completion no longer waits for viewport entry.
- Explicit play takes ownership from automatic reveal without dropping the initial mask or restarting on intersection. Existing automatic reveal behavior remains in effect until explicit play.
- Offscreen exits suppress native text/image/SVG paint immediately and retain it through reentry and completion; cancellation and disposal restore original styles. Regression covers actual departure shader clocks, seeds, coordinates and rendered smoke pixels.
- Transient effects and image swaps complete on their original offscreen timeline without waiting for visual readiness; hidden transient polling is infrequent and cancellation still restores native content.
- Images reveal native pixels at assembly completion, then fade the mesh for 250ms, including swaps.

- Reuse local rendering buffers across differently sized surfaces, avoiding repeated GPU buffer allocation.
- Clear retained scratch pixels before each local surface copy.
- Image motion preserves source colors by default (recipe glow defaults to zero).
- Gradual particle appearance on the existing effect clock.
- Free image swaps support `enter` and `topImage`, including outgoing-only melt over the next native image.
- Include the EV-RY website integration recipe and initial-reveal lifecycle guidance.

Website artwork and SPA changes are not package runtime exports. Physical-device performance and the reported first-image brightness difference are not certified by this release.

# EV-RY FX Free 0.1.0-rc.2

- Fix collapsed whitespace at wrapped line ends triggering native fallback, including Android headings with negative letter spacing.
- Respect DOM font kerning and text-rendering settings; include them in cache identity and invalidation.
- Normalize high-resolution raster advances using the actual display font size. Physical iOS width parity remains to be confirmed.
- Smooth native-rest handoff: native text fades in over 350ms starting 175ms before entry ends; the mesh fades out over the following 350ms. Reduced motion skips this transition.
- Tie the handoff to the original effect clock to avoid restarting on delayed frames.

No Free API removal or effect expansion. The marketing site's SPA router, loader and staged headlines are site behavior, not package exports.

## Previous release

# EV-RY FX Free 0.1.0-rc.1

Public preview release candidate from EV-RY. The Free edition uses the [MIT license](../LICENSE). Package: `@ev-ry/fx`. Try the [live demo](https://kbaghini.github.io/evry-fx/docs/) or browse the [source and examples](https://github.com/kbaghini/evry-fx).

The product is now EV-RY FX. Existing `THDFree`, `data-thd-*`, `createFree`, `loadFree` and `src/dom-*` names remain compatible. No behavior or API rename is implied by the branding change.

## Included

- Automatic intersection reveal for headings, marked display text and marked images.
- Manual text, image and supported static SVG attachment, plus simple image swaps.
- Four fixed presets: dust wind / smoke for text, drifting snow / melt for media. Textured triangular particles, a 2000ms timeline and native resting presentation.
- Classic script loading, explicit `loadFree()` ES-module initialization, TypeScript declarations and integration examples.
- Document-connected shared canvas with conservative local routing for special layouts.

## Reliability work

- Early opt-in masking prevents native content flashing before initial reveal, while preserving layout and providing failure recovery.
- Wrapped headings and ordinary HTML whitespace use browser-measured placement. Initially empty or recoverable unsupported text can resume after valid content/layout and refresh.
- Reentry during an unfinished reveal preserves its clock. Completed once-only entries are not restarted by minor scrolling or presentation updates.
- Unsupported content returns to native rendering instead of repeatedly retrying known failures. Repeated local refresh preserves valid attachments.
- Font loading invalidates shared pixels and refreshes rich-text meshes even when the CSS font name and line metrics stay unchanged.
- Automatic loader ownership handles browser back/forward-cache returns; manual owners retain explicit lifecycle responsibility.
- `FreeSurface.cancel()` is required in the declarations, matching the runtime API. The module loader has its own typed export.

## Performance work

- Validated, unchanged text reuses its layout before the expensive per-character placement pass. Character-frame data is collected only when the selected entry/exit effect needs it.
- Display-text raster pixels use a document-scoped cache capped at 16MiB. This is a cache limit, not total page or GPU memory.
- Offscreen images prepare near the viewport. Internal image preparation avoids an intermediate PNG encode/decode, and rapid resize requests are coalesced.
- Geometry settings, visual quality, preset choices and effect duration are preserved. These changes remove redundant work; they do not promise a universal FPS improvement or eliminate all cold WebGL startup cost.

## Validation and limits

Chrome desktop regression checks cover actual entry/exit motion, rapid reentry, plain/rich text rebuilding, whitespace and Persian mixed-text cases, fallback recovery, lifecycle cleanup and cache invalidation. Strict TypeScript consumer checks cover source and packaged declarations, cancellation, module-loader exports and rejected Free-only configuration.

Earlier document-canvas scrolling tests on physical iPhone and Android devices were reported successful by the user. That is not fresh physical-device acceptance of every optimization in this candidate, nor a guarantee for all browsers, GPUs or websites.

The Free build retains native fallback for unsupported content. Complete CSS stacking/clipping reproduction, arbitrary SVG, editable controls, custom effect recipes and dedicated framework component packs are outside this release. Cross-origin media must satisfy browser canvas restrictions. Review the [guide](GUIDE.md) before integration.

[Back to the overview](../README.md)
