/**
 * Import model files and 3MF projects into the plater (used by Import, drag & drop, library and
 * autosave restore). Kept outside the components so the store can import it statically.
 */
import { useStore, VOLUME_LABELS, type NewVolumeInput } from './state/store';
import { loadModelFile, splitGeometryByRanges, SUPPORTED_EXTENSIONS } from './three/loaders';
import { api } from './api';

type ImportItem = {
  name: string;
  geometry: import('three').BufferGeometry;
  config?: Record<string, string>;
  extruder?: number;
  volumes?: NewVolumeInput[];
  supportPaint?: string;
  seamPaint?: string;
  mmuPaint?: string;
  ranges?: Array<{ minZ: number; maxZ: number; config: Record<string, string> }>;
};

export async function importFiles(files: FileList | File[]) {
  const st = useStore.getState();
  const items: ImportItem[] = [];
  for (const f of Array.from(files)) {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      st.toast('error', `Unsupported file: ${f.name}`);
      continue;
    }
    try {
      if (ext === '3mf') {
        // project config (if any)
        try {
          const proj = await api.parseProject(await f.arrayBuffer());
          if (Object.keys(proj.config).length) {
            await st.applyProjectConfig(proj.config);
            st.toast('info', `Applied project settings from ${f.name}`);
          }
          if (proj.customGcodes?.length) st.setCustomGcodes(proj.customGcodes);
          const models = await loadModelFile(f);
          models.forEach((m, i) => {
            const po = proj.objects[i];
            const item: ImportItem = {
              name: po?.name || m.name,
              geometry: m.geometry,
              config: po?.config,
              extruder: po?.extruder,
              supportPaint: po?.supportPaint,
              seamPaint: po?.seamPaint,
              mmuPaint: po?.mmuPaint,
              ranges: po?.ranges,
            };
            // restore sub-volumes (parts, modifiers, support enforcers/blockers) from the triangle ranges
            if (po && po.volumes.length > 1) {
              const parts = splitGeometryByRanges(m.geometry, po.volumes.map((v) => [v.first, v.last] as [number, number]));
              const mainIdx = Math.max(
                0,
                po.volumes.findIndex((v) => v.type === 'ModelPart'),
              );
              item.geometry = parts[mainIdx];
              // paint strings cover the whole mesh; keep the main part's triangle range
              const mv = po.volumes[mainIdx];
              if (mv) {
                item.supportPaint = po.supportPaint?.slice(mv.first, mv.last + 1);
                item.seamPaint = po.seamPaint?.slice(mv.first, mv.last + 1);
                item.mmuPaint = po.mmuPaint?.slice(mv.first, mv.last + 1);
              }
              item.volumes = po.volumes
                .map((v, vi) => ({ name: v.name || VOLUME_LABELS[v.type], type: v.type, geometry: parts[vi], config: v.config, extruder: v.extruder }))
                .filter((_, vi) => vi !== mainIdx);
              const mainVol = po.volumes[mainIdx];
              if (mainVol?.extruder && !item.extruder) item.extruder = mainVol.extruder;
              if (mainVol && Object.keys(mainVol.config).length) item.config = { ...(item.config || {}), ...mainVol.config };
            } else if (po && po.volumes.length === 1) {
              const mainVol = po.volumes[0];
              if (mainVol.extruder && !item.extruder) item.extruder = mainVol.extruder;
            }
            items.push(item);
          });
          continue;
        } catch {
          /* fall through to plain mesh import */
        }
      }
      items.push(...(await loadModelFile(f)));
    } catch (e) {
      st.toast('error', `Cannot load ${f.name}: ${(e as Error).message}`);
    }
  }
  if (items.length) {
    const fromProject = Array.from(files).some((f) => f.name.toLowerCase().endsWith('.3mf'));
    await st.addObjects(items, { keepPositions: fromProject });
  }
}
