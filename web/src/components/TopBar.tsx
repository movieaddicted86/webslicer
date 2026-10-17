import { useEffect, useRef } from 'react';
import { useStore, isModified, VOLUME_LABELS, type View, type NewVolumeInput } from '../state/store';
import { loadModelFile, splitGeometryByRanges, SUPPORTED_EXTENSIONS } from '../three/loaders';
import { api, downloadBlob } from '../api';
import type { Mode } from '../api';

type ImportItem = {
  name: string;
  geometry: import('three').BufferGeometry;
  config?: Record<string, string>;
  extruder?: number;
  volumes?: NewVolumeInput[];
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
          const models = await loadModelFile(f);
          models.forEach((m, i) => {
            const po = proj.objects[i];
            const item: ImportItem = { name: po?.name || m.name, geometry: m.geometry, config: po?.config, extruder: po?.extruder };
            // restore sub-volumes (parts, modifiers, support enforcers/blockers) from the triangle ranges
            if (po && po.volumes.length > 1) {
              const parts = splitGeometryByRanges(m.geometry, po.volumes.map((v) => [v.first, v.last] as [number, number]));
              const mainIdx = Math.max(
                0,
                po.volumes.findIndex((v) => v.type === 'ModelPart'),
              );
              item.geometry = parts[mainIdx];
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

export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const info = useStore((s) => s.info);
  const presets = useStore((s) => s.presets);
  const objects = useStore((s) => s.objects);
  const job = useStore((s) => s.job);
  const openDialog = useStore((s) => s.openDialog);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I' || e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        fileRef.current?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tabs: Array<{ id: View; label: string; dot?: boolean }> = [
    { id: 'plater', label: 'Plater' },
    { id: 'preview', label: 'Preview' },
    { id: 'print', label: 'Print Settings', dot: isModified(presets.print) },
    { id: 'filament', label: 'Filament Settings', dot: presets.filament.some(isModified) },
    { id: 'printer', label: 'Printer Settings', dot: isModified(presets.printer) },
  ];

  const exportProject = async () => {
    const st = useStore.getState();
    if (!st.objects.length) return st.toast('error', 'Nothing to export');
    const req = st.buildSliceRequest();
    if (!req.objects.length) return st.toast('error', 'Models are still uploading');
    try {
      const blob = await api.export3mf(req);
      downloadBlob(blob, `${req.outputName || 'project'}.3mf`);
    } catch (e) {
      st.toast('error', (e as Error).message);
    }
  };
  const exportConfig = async () => {
    const st = useStore.getState();
    const req = st.buildSliceRequest();
    try {
      downloadBlob(await api.exportConfig(req), 'config.ini');
    } catch (e) {
      st.toast('error', (e as Error).message);
    }
  };

  return (
    <header className="topbar">
      <div className="brand" title={`WebSlicer ${info?.version || ''} · PrusaSlicer ${info?.slicerVersion || ''}`}>
        <span className="logo" />
        WebSlicer
      </div>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.id} className={view === t.id ? 'active' : ''} onClick={() => setView(t.id)}>
            {t.label}
            {t.dot && <span className="dot" title="modified" />}
          </button>
        ))}
      </nav>
      <div className="spacer" />
      <div className="menu">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".stl,.obj,.3mf,.amf"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) importFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileRef.current?.click()} title="Import STL/OBJ/3MF/AMF from this computer (Ctrl+I)">
          ⤓ Import
        </button>
        <button onClick={() => openDialog('library', 'open')} title="Open models, projects and G-code from the server library (mounted folder)">
          🗂 Library
        </button>
        <div className="dropdown">
          <button>Export ▾</button>
          <div className="dropdown-menu">
            <button onClick={exportProject} disabled={!objects.length}>
              Export project as 3MF
            </button>
            <button onClick={exportConfig}>Export config bundle (.ini)</button>
            <button
              disabled={!job || job.status !== 'done'}
              onClick={() => job && (location.href = api.gcodeUrl(job.id, true))}
            >
              Export G-code
            </button>
            <button onClick={() => openDialog('library', 'saveProject')} disabled={!objects.length}>
              Save project to library…
            </button>
            <button disabled={!job || job.status !== 'done'} onClick={() => openDialog('library', 'saveGcode')}>
              Save G-code to library…
            </button>
          </div>
        </div>
        <button onClick={() => openDialog('physicalPrinters')} title="Physical printers (print hosts)">
          🖶 Printers
        </button>
        <select className="mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)} title="Settings visibility">
          <option value="simple">Simple</option>
          <option value="advanced">Advanced</option>
          <option value="expert">Expert</option>
        </select>
        <button onClick={() => openDialog('about')} title="About">
          ?
        </button>
      </div>
    </header>
  );
}
