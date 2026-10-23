/**
 * The loader hooks for `node --test`: a `.css` import resolves to an empty module. The component
 * sheets are imported for the side effect (q8-housekeeping); a test has no stylesheet to apply.
 * Registered by `register.mjs`, which is what the `test` script points `--import` at.
 */
const STUB = 'data:text/css,export default {};';

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('.css')) return { url: STUB, shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === STUB) return { format: 'module', source: 'export default {};', shortCircuit: true };
  return next(url, context);
}
