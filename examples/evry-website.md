# EV-RY website: product showcase

The EV-RY marketing website is a real integration case: a four-product showcase, animated captions, one shared FX installation across client-side navigation, and native content at rest.

The website is currently a local integration at `http://127.0.0.1:8780/`, not a hosted demo included in this package. The public runnable examples are linked from the package README. The website backend, forms and artwork are not dependencies of FX.

## Initial reveal without a flash

Place `data-thd-pending` on the image and caption elements in the HTML, use the documented boot mask, then let `revealOnView` transfer the mask to the first rendered frame. Keep each returned handle until cleanup. Do not remove the mask manually on attachment readiness.

```js
const imageSurface = engine.attachImage(image, {
  presentation: 'global',
  revealOnView: { threshold: 0, once: true }
});
const captionSurfaces = captionLines.map(line => {
  const surface = engine.attachText(line, {
    presentation: 'local',
    revealOnView: { threshold: 0, once: true }
  });
  surface.play('enter');
  return surface;
});
```

The captions explicitly start with the slide, even when below the viewport. `play()` takes control from automatic intersection reveal while retaining its initial paint mask until a rendered frame. It does not wait for visibility or restart on reentry. Without explicit `play()`, `revealOnView` continues to wait for the configured intersection and follows its `once` setting.

## Alternate two image transitions

After decoding the next mounted image, alternate between incoming snow over the previous image and outgoing melt above the already visible next image:

```js
const transition = engine.swapImage(previous, next, {
  enter: !melt,
  exit: melt,
  topImage: melt ? 'previous' : 'next',
  waitForExit: false,
  presentation: 'global'
});
const result = await transition.finished;
if (result.status === 'completed') previous.remove();
```

Use a busy flag to prevent overlapping swaps. Pause scheduling while the document is hidden. On navigation, cancel an outstanding transition, clear the scheduled timeout and destroy page handles; retain the shared engine and refresh its automatic attachments after inserting the new page. Install the boot mask before the new DOM can paint. Destroy the engine only when the application is disposed.

The five-second scheduling interval, caption layout, routing and product artwork belong to the website, not to the FX API. Local caption surfaces share rendering infrastructure; the retained scratch buffer avoids resizing the GPU buffer for each caption line.

Create incoming captions from fresh authored markup rather than cloning a currently attached element: a live attachment can carry temporary engine-owned visibility attributes and styles. Commit the incoming image and caption together only after `transition.finished` reports `completed`. If image decoding, attachment or the swap fails, destroy incoming caption handles, remove their layer, retain the previous caption and image, then retry. Track each acquired handle immediately so partial attachment failures can also be cleaned up.

Schedule one deadline five seconds from each transition start. After completion, wait only for the remaining time. If the transition itself overruns that deadline, start one next transition when available and establish a new deadline; do not discard interval ticks or queue catch-up transitions. Returning from a hidden tab and retrying a failed transition each establish a fresh five-second wait. This keeps start-to-start cadence stable without overlapping jobs.

## Completion

After `surface.play()`, await `surface.whenFinished()`. It returns a status of `completed`, `cancelled`, or `unsupported`. Completion includes the native handoff; avoid fixed cleanup timers or renderer statistics. Destroy page surfaces when navigating away.

Offscreen text and media retain their start time without running per-particle updates or drawing frames. Returning during the effect evaluates its current elapsed time; returning after it ends shows the final state without replay. `whenFinished()` also completes when content remains offscreen, so slider cleanup never depends on scrolling captions into view. It checks the suspended clock infrequently instead of maintaining a render loop. Concurrent waits share a pending promise; starting a new play cancels the previous wait. Cancel or destroy the handle to release an outstanding wait.

When an exit is requested offscreen, the engine immediately suppresses native paint while retaining layout and the DOM content. Native paint also remains hidden if an active departure leaves view. Reentry renders only the remaining departure particles; an expired exit stays hidden. Text, image and SVG attachments own this masking, so the site should not toggle native opacity or visibility to emulate it. Cancel/destroy restores the original presentation.
