# E2E selectors: hooks, not structure

Part of [CONVENTIONS.md](../CONVENTIONS.md) §5.

The layout work moves the sidebar, the tool bar, the top bar and the preview controls between
regions. A spec that encodes _where_ an element sits (`.sidebar .quick-settings`,
`.tool-bar button:nth-child(2)`, a descendant chain through a container) breaks on every move.

- Structural elements carry a `data-testid` hook named by **role, not place**: `app-shell`,
  `top-bar`, `rail` (+ `-slicing`, `-library`, `-printers`, `-preferences`, `-about`), `menu`,
  `hide-panels`, `context-panel` (+ `-header`, `-footer`), `left-column` (+ `-toggle`,
  `left-sliced-toggle`, `left-legend-toggle`, `objects-drawer-toggle`),
  `presets`, `preset-select-<type>`, `object-list`, `object-toolbar`,
  `object-row` (plus `data-object-id`), `object-info`, `object-transform`, `object-settings-card`,
  `object-settings`, `parts-card`, `object-add-volume`, `volume-list`, `range-card`, `range-list`,
  `range-add`, `destination`, `multi-selection`, `quick-settings`, `slice-panel`,
  `slice-button`, `tool-bar`, `tool-strip`, `tool-overflow`, `tool-<toolId>`, `tool-panel`
  (+ `-title`, `-foot`, `-close`), `tool-hints`, `view-switch` (+ `view-plater`, `view-preview`),
  `modal` (+ `-title`, `-actions`, `-primary`, `-close`, `-backdrop`), `preview-panel`,
  `layer-slider`, `move-slider`, `legend`, `sliced-info`, `send-button`, `toast`. A hook must stay
  correct when the element moves to another region; add one when the region changes, not when a
  class is convenient.
- Specs locate these with the hook, never with the structural class: `byId(page, 'tool-panel')`
  from `e2e/helpers/hooks.ts` (or `[data-testid="tool-panel"]` inside a `page.evaluate`).
  `playwright.config.ts` sets `testIdAttribute: 'data-testid'` explicitly so `getByTestId` cannot
  drift from the app.
- Locators that do **not** depend on position stay as they are: field labels, button texts, ARIA
  roles, `title` tooltips and the element's own visual state classes (`.selected`, `.outside`,
  `.primary`).
- `e2e/hooks.test.ts` (run by `npm test`) fails when a spec uses `.sidebar`, `.tool-bar`,
  `.tool-panel`, `.object-row`, `.slice-panel`, `.quick-settings`, `.presets`, `.objects` or
  `.modal` as a selector, and when one of the hooks above disappears from the components. An
  exception goes into its allow-list with a reason, and it has to keep occurring.
- Hooks are additive: the class names stay (CSS and the DOM outline use them), and the production
  build keeps the attributes – stripping them would make the E2E build differ from the shipped one.
