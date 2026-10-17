import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore, isModified } from '../../state/store';
import { api, type InstalledPrinter, type PhysicalPrinter, type PresetType, type Vendor } from '../../api';
import { OptionField } from '../OptionField';
import { MODE_RANK } from '../../values';

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AddPrinterDialog({ onClose }: { onClose: () => void }) {
  const vendors = useStore((s) => s.vendors);
  const installed = useStore((s) => s.installed);
  const installPrinters = useStore((s) => s.installPrinters);
  const selectPreset = useStore((s) => s.selectPreset);
  const toast = useStore((s) => s.toast);
  const [vendorId, setVendorId] = useState(vendors[0]?.id || '');
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<InstalledPrinter[]>(installed);
  const [tab, setTab] = useState<'vendor' | 'custom'>('vendor');
  const [custom, setCustom] = useState({ name: 'My Printer', x: 220, y: 220, z: 250, nozzle: 0.4, flavor: 'marlin2' });
  const vendor: Vendor | undefined = vendors.find((v) => v.id === vendorId);
  const has = (m: { vendorId: string; id: string }, variant: string) => sel.some((i) => i.vendorId === m.vendorId && i.modelId === m.id && i.variant === variant);
  const toggleVariant = (m: { vendorId: string; id: string }, variant: string) =>
    setSel((s) => (has(m, variant) ? s.filter((i) => !(i.vendorId === m.vendorId && i.modelId === m.id && i.variant === variant)) : [...s, { vendorId: m.vendorId, modelId: m.id, variant }]));
  const models = (vendor?.models || []).filter((m) => !filter || m.name.toLowerCase().includes(filter.toLowerCase()));
  const families = [...new Set(models.map((m) => m.family || 'Other'))];

  const save = async () => {
    try {
      await installPrinters(sel);
      const added = sel.find((i) => !installed.some((x) => x.vendorId === i.vendorId && x.modelId === i.modelId && x.variant === i.variant));
      if (added) {
        const lists = useStore.getState().presetLists.printer;
        const p = lists.find((x) => x.vendorId === added.vendorId && x.printerModel === added.modelId && x.printerVariant === added.variant);
        if (p) await selectPreset('printer', p.name);
      }
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const saveCustom = async () => {
    try {
      const def = await api.getPreset('printer', '- default FFF -');
      const cfg = {
        ...def.config,
        bed_shape: `0x0,${custom.x}x0,${custom.x}x${custom.y},0x${custom.y}`,
        max_print_height: String(custom.z),
        nozzle_diameter: String(custom.nozzle),
        gcode_flavor: custom.flavor,
        printer_technology: 'FFF',
      };
      await api.savePreset('printer', custom.name, cfg);
      await useStore.getState().refreshPresetLists();
      await selectPreset('printer', custom.name);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <Modal title="Printers" onClose={onClose} wide>
      <div className="subtabs">
        <button className={tab === 'vendor' ? 'active' : ''} onClick={() => setTab('vendor')}>
          Vendor profiles
        </button>
        <button className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>
          Custom printer
        </button>
      </div>
      {tab === 'vendor' ? (
        <div className="add-printer">
          <div className="vendor-list">
            <input placeholder="Filter models…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <ul>
              {vendors.map((v) => (
                <li key={v.id} className={v.id === vendorId ? 'active' : ''} onClick={() => setVendorId(v.id)}>
                  {v.name}
                  {sel.some((i) => i.vendorId === v.id) && <span className="badge">{sel.filter((i) => i.vendorId === v.id).length}</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className="model-list">
            {families.map((fam) => (
              <div key={fam} className="family">
                <h3>{fam}</h3>
                {models
                  .filter((m) => (m.family || 'Other') === fam)
                  .map((m) => (
                    <div key={m.id} className="model">
                      {m.thumbnail && <img src={`/api/vendors/${m.vendorId}/asset/${m.thumbnail}`} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
                      <div className="model-body">
                        <div className="model-name">
                          {m.name} <span className="muted small">{m.technology}</span>
                        </div>
                        <div className="variants">
                          {(m.variants.length ? m.variants : ['']).map((v) => (
                            <label key={v} className="checkbox">
                              <input type="checkbox" checked={has(m, v)} onChange={() => toggleVariant(m, v)} /> {v ? `${v} mm` : 'default'}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            ))}
            {!models.length && <div className="muted">No models.</div>}
          </div>
          <div className="modal-actions">
            <span className="muted small">{sel.length} printer variants selected</span>
            <button className="primary" onClick={save}>
              Apply
            </button>
          </div>
        </div>
      ) : (
        <div className="custom-printer">
          <label>
            Name <input value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} />
          </label>
          <label>
            Bed size X (mm) <input type="number" value={custom.x} onChange={(e) => setCustom({ ...custom, x: Number(e.target.value) })} />
          </label>
          <label>
            Bed size Y (mm) <input type="number" value={custom.y} onChange={(e) => setCustom({ ...custom, y: Number(e.target.value) })} />
          </label>
          <label>
            Max print height (mm) <input type="number" value={custom.z} onChange={(e) => setCustom({ ...custom, z: Number(e.target.value) })} />
          </label>
          <label>
            Nozzle diameter (mm) <input type="number" step="0.05" value={custom.nozzle} onChange={(e) => setCustom({ ...custom, nozzle: Number(e.target.value) })} />
          </label>
          <label>
            Firmware flavor
            <select value={custom.flavor} onChange={(e) => setCustom({ ...custom, flavor: e.target.value })}>
              {['marlin2', 'marlin', 'klipper', 'reprapfirmware', 'repetier', 'smoothie', 'sailfish', 'mach3', 'machinekit', 'teacup', 'no-extrusion'].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">Creates a user printer preset from the default profile. Adjust start/end G-code and retraction afterwards in Printer Settings.</p>
          <div className="modal-actions">
            <button className="primary" onClick={saveCustom} disabled={!custom.name.trim()}>
              Create printer
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function PhysicalPrintersDialog({ onClose }: { onClose: () => void }) {
  const printers = useStore((s) => s.physicalPrinters);
  const refresh = useStore((s) => s.refreshPhysicalPrinters);
  const toast = useStore((s) => s.toast);
  const empty: Partial<PhysicalPrinter> = { name: '', type: 'prusalink', host: '', apiKey: '' };
  const [edit, setEdit] = useState<Partial<PhysicalPrinter> | null>(printers.length ? null : empty);
  const [testing, setTesting] = useState<string>('');

  const save = async () => {
    if (!edit) return;
    try {
      if (edit.id) await api.updatePrinter(edit.id, edit);
      else await api.addPrinter(edit);
      await refresh();
      setEdit(null);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const test = async () => {
    if (!edit) return;
    setTesting('…');
    const r = edit.id && (!edit.apiKey || edit.apiKey === '••••••••') ? await api.testPrinterById(edit.id).catch((e) => ({ ok: false, message: e.message })) : await api.testPrinter(edit).catch((e) => ({ ok: false, message: e.message }));
    setTesting(r.ok ? `✓ ${r.message}` : `✗ ${r.message}`);
  };
  return (
    <Modal title="Physical printers" onClose={onClose}>
      {!edit && (
        <>
          <ul className="printer-list">
            {printers.map((p) => (
              <li key={p.id}>
                <div>
                  <b>{p.name}</b> <span className="muted small">{p.type} · {p.host}</span>
                </div>
                <div>
                  <button onClick={() => setEdit({ ...p, apiKey: p.hasApiKey ? '••••••••' : '' })}>Edit</button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete ${p.name}?`)) return;
                      await api.deletePrinter(p.id);
                      refresh();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
            {!printers.length && <li className="muted">No printers configured.</li>}
          </ul>
          <div className="modal-actions">
            <button className="primary" onClick={() => setEdit(empty)}>
              Add printer
            </button>
          </div>
        </>
      )}
      {edit && (
        <div className="form">
          <label>
            Name <input value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </label>
          <label>
            Host type
            <select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as PhysicalPrinter['type'] })}>
              <option value="prusalink">PrusaLink (MK4/MK3.9/XL/MINI, MK3S with Pi)</option>
              <option value="octoprint">OctoPrint</option>
              <option value="moonraker">Klipper / Moonraker (Mainsail, Fluidd)</option>
            </select>
          </label>
          <label>
            Hostname / IP <input placeholder="192.168.1.50 or http://printer.local" value={edit.host || ''} onChange={(e) => setEdit({ ...edit, host: e.target.value })} />
          </label>
          <label>
            API key <input value={edit.apiKey || ''} onChange={(e) => setEdit({ ...edit, apiKey: e.target.value })} placeholder={edit.type === 'moonraker' ? 'optional' : 'required'} />
          </label>
          {testing && <div className={`small ${testing.startsWith('✓') ? 'success' : 'error'}`}>{testing}</div>}
          <div className="modal-actions">
            <button onClick={() => setEdit(null)}>Cancel</button>
            <button onClick={test} disabled={!edit.host}>
              Test connection
            </button>
            <button className="primary" onClick={save} disabled={!edit.host || !edit.name}>
              Save
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function SendToPrinterDialog({ onClose }: { onClose: () => void }) {
  const printers = useStore((s) => s.physicalPrinters);
  const job = useStore((s) => s.job);
  const toast = useStore((s) => s.toast);
  const [printerId, setPrinterId] = useState(printers[0]?.id || '');
  const [filename, setFilename] = useState(job?.outputName || 'print.gcode');
  const [start, setStart] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!job) return;
    setBusy(true);
    try {
      const r = await api.sendToPrinter(job.id, printerId, filename, start);
      toast(r.ok ? 'success' : 'error', r.message);
      if (r.ok) onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Send G-code to printer" onClose={onClose}>
      <div className="form">
        <label>
          Printer
          <select value={printerId} onChange={(e) => setPrinterId(e.target.value)}>
            {printers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.type})
              </option>
            ))}
          </select>
        </label>
        <label>
          File name <input value={filename} onChange={(e) => setFilename(e.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={start} onChange={(e) => setStart(e.target.checked)} /> Start printing after upload
        </label>
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={send} disabled={busy || !printerId}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function SavePresetDialog({ onClose, payload }: { onClose: () => void; payload: { type: PresetType; extruderIdx: number } }) {
  const presets = useStore((s) => s.presets);
  const savePresetAs = useStore((s) => s.savePresetAs);
  const toast = useStore((s) => s.toast);
  const slot = payload.type === 'filament' ? presets.filament[payload.extruderIdx] : presets[payload.type as 'print' | 'printer'];
  const suggested = slot.system ? `${slot.name.replace(/^- default (FFF|SLA) -$/, 'My preset')} - Copy` : slot.name;
  const [name, setName] = useState(suggested);
  const lists = useStore((s) => s.presetLists[payload.type]);
  const exists = lists.find((p) => p.name === name.trim());
  const save = async () => {
    try {
      await savePresetAs(payload.type, name.trim(), payload.extruderIdx);
      onClose();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  return (
    <Modal title={`Save ${payload.type} preset`} onClose={onClose}>
      <div className="form">
        <label>
          Preset name <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && !(exists?.system) && save()} />
        </label>
        {exists?.system && <div className="error small">A system preset with this name exists; choose a different name.</div>}
        {exists && !exists.system && <div className="warn small">User preset will be overwritten.</div>}
        {!isModified(slot) && <div className="muted small">No changes yet – saving creates a copy of the current preset.</div>}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!name.trim() || name.trim().startsWith('-') || !!exists?.system}>
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
const OBJECT_SETTING_EXCLUDES = new Set([
  'compatible_printers',
  'compatible_printers_condition',
  'complete_objects',
  'extruder_clearance_height',
  'extruder_clearance_radius',
  'gcode_comments',
  'gcode_label_objects',
  'output_filename_format',
  'post_process',
  'notes',
  'skirts',
  'skirt_distance',
  'skirt_height',
  'draft_shield',
  'min_skirt_length',
  'wipe_tower',
  'wipe_tower_x',
  'wipe_tower_y',
  'wipe_tower_width',
  'wipe_tower_rotation_angle',
  'wipe_tower_brim_width',
  'wipe_tower_bridging',
  'wipe_tower_cone_angle',
  'wipe_tower_extra_spacing',
  'wipe_tower_extra_flow',
  'wipe_tower_no_sparse_layers',
  'single_extruder_multi_material_priming',
  'spiral_vase',
  'max_print_speed',
  'max_volumetric_speed',
  'travel_speed',
  'travel_speed_z',
  'resolution',
  'gcode_resolution',
]);

/** Settings that only make sense per object, not per modifier/part volume (PrusaSlicer "object only"). */
const OBJECT_ONLY_PREFIXES = ['support_material', 'support_tree', 'raft_', 'brim_', 'skirt', 'seam_', 'staggered_inner_seams', 'scarf_seam', 'layer_height', 'first_layer_height', 'slicing_mode', 'xy_size_compensation', 'elefant_foot', 'dont_support_bridges', 'interface_shells', 'mmu_segmented', 'wipe_into', 'infill_only_where_needed', 'only_one_perimeter_first_layer', 'avoid_crossing', 'thick_bridges', 'ooze_prevention', 'standby_temperature'];

function ObjectSettingsDialog({ onClose, objectId, volumeId }: { onClose: () => void; objectId: string; volumeId?: string }) {
  const o = useStore((s) => s.objects.find((x) => x.id === objectId));
  const schema = useStore((s) => s.schema)!;
  const updateObject = useStore((s) => s.updateObject);
  const updateVolume = useStore((s) => s.updateVolume);
  const printCfg = useStore((s) => s.presets.print.current);
  const mode = useStore((s) => s.mode);
  const [search, setSearch] = useState('');
  const vol = volumeId ? o?.volumes.find((v) => v.id === volumeId) : undefined;
  const forVolume = !!vol;
  const candidates = useMemo(
    () =>
      schema.presetKeys.print
        .filter((k) => !OBJECT_SETTING_EXCLUDES.has(k) && schema.options[k] && MODE_RANK[schema.options[k].mode || 'expert'] <= MODE_RANK[mode])
        .filter((k) => !forVolume || !OBJECT_ONLY_PREFIXES.some((p) => k.startsWith(p)))
        .filter((k) => !search || k.includes(search.toLowerCase()) || schema.options[k].label.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => schema.options[a].label.localeCompare(schema.options[b].label)),
    [schema, search, mode, forVolume],
  );
  if (!o) return null;
  const config = vol ? vol.config : o.config;
  const setConfig = (c: Record<string, string>) => (vol ? updateVolume(o.id, vol.id, { config: c }) : updateObject(o.id, { config: c }));
  const keys = Object.keys(config);
  const title = vol ? `${vol.type === 'ParameterModifier' ? 'Modifier' : 'Part'} settings – ${vol.name} (${o.name})` : `Per-object settings – ${o.name}`;
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="object-settings">
        <div className="object-settings-list">
          <input placeholder="Add setting… (search)" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul>
            {candidates.slice(0, 200).map((k) => (
              <li key={k} className={config[k] !== undefined ? 'added' : ''} onClick={() => config[k] === undefined && setConfig({ ...config, [k]: printCfg[k] ?? schema.options[k].default })}>
                <span>{schema.options[k].label}</span>
                <span className="muted small">{schema.options[k].category}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="object-settings-values">
          {!keys.length && (
            <div className="muted">
              No overrides. Pick a setting on the left to override it for this {vol ? 'volume' : 'object'} only.
            </div>
          )}
          {keys.map((k) => {
            const def = schema.options[k];
            if (!def) return null;
            return (
              <div key={k} className="override-row">
                <OptionField def={def} value={config[k]} savedValue={printCfg[k]} extruders={1} onChange={(v) => setConfig({ ...config, [k]: v })} onReset={() => setConfig({ ...config, [k]: printCfg[k] ?? def.default })} />
                <button
                  className="icon"
                  title="Remove override"
                  onClick={() => {
                    const c = { ...config };
                    delete c[k];
                    setConfig(c);
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
function AboutDialog({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.info);
  return (
    <Modal title="About WebSlicer" onClose={onClose}>
      <p>
        <b>WebSlicer</b> {info?.version} – a web frontend for the PrusaSlicer slicing engine.
      </p>
      <table className="kv">
        <tbody>
          <tr>
            <td>Slicer engine</td>
            <td>PrusaSlicer {info?.slicerVersion}</td>
          </tr>
          <tr>
            <td>Vendor bundles</td>
            <td>{info?.vendors}</td>
          </tr>
          <tr>
            <td>Parallel jobs</td>
            <td>{info?.maxJobs}</td>
          </tr>
        </tbody>
      </table>
      <p className="muted small">
        PrusaSlicer is © Prusa Research, licensed under AGPL-3.0. WebSlicer is an independent project and is not affiliated with Prusa Research.
      </p>
      <p className="small">
        Shortcuts: <kbd>M</kbd> move · <kbd>R</kbd> rotate · <kbd>S</kbd> scale · <kbd>A</kbd> arrange · <kbd>Del</kbd> delete · <kbd>Ctrl+A</kbd> select all
      </p>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  const payload = useStore((s) => s.dialogPayload);
  const close = useStore((s) => s.closeDialog);
  switch (dialog) {
    case 'addPrinter':
      return <AddPrinterDialog onClose={close} />;
    case 'physicalPrinters':
      return <PhysicalPrintersDialog onClose={close} />;
    case 'sendToPrinter':
      return <SendToPrinterDialog onClose={close} />;
    case 'savePreset':
      return <SavePresetDialog onClose={close} payload={payload as { type: PresetType; extruderIdx: number }} />;
    case 'objectSettings':
      return <ObjectSettingsDialog onClose={close} {...(payload as { objectId: string; volumeId?: string })} />;
    case 'about':
      return <AboutDialog onClose={close} />;
    default:
      return null;
  }
}
