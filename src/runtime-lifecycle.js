// Resource ownership only. No text, font, form or renderer dependencies.
export function createLifecycle() {
  let disposed = false;
  const cleanups = [];
  function own(cleanup) {
    if (disposed) cleanup(); else cleanups.push(cleanup);
  }
  return {
    get disposed() { return disposed; },
    own,
    listen(target, type, callback, options) {
      if (!target || disposed) return;
      target.addEventListener(type, callback, options);
      own(() => target.removeEventListener(type, callback, options));
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      const errors = [];
      for (const cleanup of cleanups.splice(0).reverse()) {
        try { cleanup(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'Runtime cleanup failed');
    },
  };
}
