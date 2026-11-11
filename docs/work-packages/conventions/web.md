# Web specifics

Part of [CONVENTIONS.md](../CONVENTIONS.md) §4. Web tests run from `web/` with the CSS loader, one
line: `cd web && npx tsx --import ./test/css-loader.mjs --test --test-reporter=dot "src/**/*.test.ts"`.

- State lives in the Zustand store: `web/src/state/store.ts` composes `useStore` from the slice
  creators in `web/src/state/slices/` (one file per area) and re-exports the domain types, so
  components keep importing from `state/store`. Components read with selectors
  (`useStore((s) => s.objects)`), never mutate state directly, and call store actions.
- Component styles live in a plain `*.css` file next to the component (`ObjectRow.css`) and are
  imported for their side effect; selectors stay global (the classes are still the styling handle
  and the DOM outline prints them, even though the E2E specs select by hooks). Not CSS Modules: Vite 8 tree-shakes a `*.module.css` import whose class map is unused, so a
  component would silently lose its styles in the production build. Tokens, the reset, form
  controls and the app frame live in `web/src/styles.css`, which `main.tsx` imports **before** the
  app so the element-level rules lose against the component sheets.
- Every user-visible plater change: call `get().recordHistory()` **before** the change (undo/redo)
  and set `sliceDirty: true`.
- IDs are strings with a prefix and a module counter (`obj-12`, `vol-3`, `rng-4`). Follow that
  pattern for new entity types.
- three.js: imports of the `three` package and `three/examples/**` live in `web/src/three/**` only
  (ESLint enforces it); `state/types.ts` may `import type` it for the geometry type, and tests may
  build fixtures with it. `state/**` never imports a `three/**` module at runtime – store actions
  reach three.js through `plater/meshOps`, and pure logic goes to `plater/`. The viewer may import
  `state/store` (it reads the store), not the other way round.
- three.js: share `BufferGeometry` between meshes that show the same mesh; dispose geometries and
  materials you created when objects are removed.
- UI: PrusaSlicer wording; tooltips name the shortcut in parentheses (`title="Arrange (A)"`).
  A new shortcut goes into the `SHORTCUTS` table in `three/viewer/shortcuts.ts` **only**: the key
  handler (`three/viewer/useKeyboardShortcuts.ts`) and the shortcut line of the About dialog read
  that table, so there is nothing else to update. Respect the mode switch (Simple hides the object
  list).
- The store is exposed as `window.webslicer` for debugging and scripted browser checks.
