import { parseGcode } from './parser';

self.onmessage = (ev: MessageEvent<{ text: string }>) => {
  try {
    const parsed = parseGcode(ev.data.text);
    const transfer = [
      parsed.positions.buffer,
      parsed.types.buffer,
      parsed.layers.buffer,
      parsed.tools.buffer,
      parsed.travelPositions.buffer,
      parsed.travelLayers.buffer,
      parsed.layerZ.buffer,
      parsed.layerStart.buffer,
      parsed.travelLayerStart.buffer,
    ];
    (self as unknown as Worker).postMessage({ ok: true, parsed }, transfer);
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: (e as Error).message });
  }
};
