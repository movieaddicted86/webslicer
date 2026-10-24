/**
 * The open tool's controls, rendered in the context panel's tool mode (layout 3.0, L-4). It picks the
 * panel component by the `panel` kind of the open tool's registry entry; no tool with a panel is open
 * → nothing renders. The tool's own logic is untouched: this is only the host that used to dock the
 * panel next to the tool bar.
 */
import { useStore } from '../../state/store';
import { toolById } from '../../tools/registry';
import { CutToolPanel } from '../tools/panels/CutToolPanel';
import { PaintToolPanel } from '../tools/panels/PaintToolPanel';
import { PlaceOnFacePanel } from '../tools/panels/PlaceOnFacePanel';
import { LayerHeightPanel } from '../tools/panels/LayerHeightPanel';

export function ToolMode() {
  const tool = toolById(useStore((s) => s.activeTool));
  switch (tool?.panel) {
    case 'cut':
      return <CutToolPanel />;
    case 'paint':
      return <PaintToolPanel />;
    case 'placeOnFace':
      return <PlaceOnFacePanel />;
    case 'layerHeight':
      return <LayerHeightPanel />;
    default:
      return null;
  }
}
