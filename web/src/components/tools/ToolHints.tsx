/**
 * The key-hint block at the end of every tool panel (I-3): the mouse buttons, wheel or drag and the
 * key chips, each next to one line that says what it does. The rows come from the tool's registry
 * entry (`hints`), so a tool cannot open without them and the block can never describe behaviour the
 * code does not have – the registry is the one place a tool is described.
 *
 * Mouse pictures come from the icon table (`mouseLeft`, …), keys are plain `<kbd>` chips; the text is
 * the accessible content, the chips and icons are decoration.
 */
import type { IconName } from '../../icons/table';
import type { HintMouse, ToolDefinition, ToolHint } from '../../tools/registry';
import { Icon } from '../../icons/Icon';
import './ToolHints.css';

const MOUSE_ICONS: Record<HintMouse, IconName> = {
  left: 'mouseLeft',
  right: 'mouseRight',
  wheel: 'mouseWheel',
  drag: 'mouseDrag',
};

/** One row: the chips in front of the effect. */
function HintRow({ hint }: { hint: ToolHint }) {
  return (
    <li className="tool-hint">
      <span className="tool-hint-keys">
        {hint.keys?.map((key) => (
          <kbd key={key}>{key}</kbd>
        ))}
        {hint.keys?.length && hint.mouse ? <span className="tool-hint-plus">+</span> : null}
        {hint.mouse && <Icon name={MOUSE_ICONS[hint.mouse]} size={16} className="tool-hint-mouse" />}
      </span>
      <span className="tool-hint-text">{hint.text}</span>
    </li>
  );
}

export function ToolHints({ tool }: { tool: ToolDefinition }) {
  if (!tool.hints?.length) return null;
  return (
    <div className="tool-hints" data-testid="tool-hints" aria-label="Key hints">
      <ul>
        {tool.hints.map((hint, i) => (
          <HintRow key={i} hint={hint} />
        ))}
      </ul>
    </div>
  );
}
