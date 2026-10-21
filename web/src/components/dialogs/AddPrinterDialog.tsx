import { useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import { api, type InstalledPrinter, type Vendor } from '../../api';

/** "Add / remove printers…": vendor profiles to install, or a custom printer from the default profile. */
export function AddPrinterDialog({ onClose }: { onClose: () => void }) {
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
