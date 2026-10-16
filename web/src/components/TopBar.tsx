import { useEffect, useRef } from 'react';
import { useStore, isModified, type View } from '../state/store';
import { loadModelFile, SUPPORTED_EXTENSIONS } from '../three/loaders';
import { api, downloadBlob } from '../api';
import type { Mode } from '../api';

export async function importFiles(files: FileList | File[]) {
  const st = useStore.getState();
  const items: Array<{ name: string; geometry: import('three').BufferGeometry }> = [];
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
            const oc = proj.objects[i]?.config;
            if (oc) (m as unknown as { config?: Record<string, string> }).config = oc;
            if (proj.objects[i]?.name) m.name = proj.objects[i].name;
          });
          items.push(...models);
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
    // apply per-object configs from 3MF
    const objs = useStore.getState().objects.slice(-items.length);
    items.forEach((it, i) => {
      const cfg = (it as unknown as { config?: Record<string, string> }).config;
      if (cfg && objs[i]) {
        const { extruder, ...rest } = cfg;
        st.updateObject(objs[i].id, { config: rest, extruder: extruder ? Number(extruder) : 0 });
      }
    });
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
        <button onClick={() => fileRef.current?.click()} title="Import STL/OBJ/3MF/AMF (Ctrl+I)">
          ⤓ Import
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
