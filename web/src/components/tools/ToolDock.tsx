/**
 * The open tool's panel, docked to the right of the tool bar over the 3D view (T-046). It picks the
 * panel component by the `panel` kind of the open tool's registry entry; no tool is active → nothing
 * renders.
 */
import { useStore } from '../../state/store';
import { toolById } from '../../tools/registry';
import { CutToolPanel } from './panels/CutToolPanel';
import { PaintToolPanel } from './panels/PaintToolPanel';
import { PlaceOnFacePanel } from './panels/PlaceOnFacePanel';
import { LayerHeightPanel } from './panels/LayerHeightPanel';

export function ToolDock() {
  const activeTool = useStore((s) => s.activeTool);
  const tool = toolById(activeTool);
  if (!tool?.panel) return null;
  switch (tool.panel) {
    case 'cut':
      return <CutToolPanel />;
    case 'paint':
      return <PaintToolPanel />;
    case 'placeOnFace':
      return <PlaceOnFacePanel />;
    case 'layerHeight':
      return <LayerHeightPanel />;
  }
}
