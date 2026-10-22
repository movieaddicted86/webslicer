import { useMemo, useState } from 'react';
import { Modal } from './Modal';
import { useStore } from '../../state/store';
import { OptionField } from '../OptionField';
import { ACTION_ICONS } from '../common/icons';
import { MODE_RANK } from '../../values';

/** Print settings that never make sense per object (they describe the whole plate or the output). */
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
const OBJECT_ONLY_PREFIXES = [
  'support_material',
  'support_tree',
  'raft_',
  'brim_',
  'skirt',
  'seam_',
  'staggered_inner_seams',
  'scarf_seam',
  'layer_height',
  'first_layer_height',
  'slicing_mode',
  'xy_size_compensation',
  'elefant_foot',
  'dont_support_bridges',
  'interface_shells',
  'mmu_segmented',
  'wipe_into',
  'infill_only_where_needed',
  'only_one_perimeter_first_layer',
  'avoid_crossing',
  'thick_bridges',
  'ooze_prevention',
  'standby_temperature',
];

/** The overrides of one object, volume or height range: search on the left, the changed options on the right. */
export function ObjectSettingsDialog({
  onClose,
  objectId,
  volumeId,
  rangeId,
}: {
  onClose: () => void;
  objectId: string;
  volumeId?: string;
  rangeId?: string;
}) {
  const o = useStore((s) => s.objects.find((x) => x.id === objectId));
  const schema = useStore((s) => s.schema);
  const updateObject = useStore((s) => s.updateObject);
  const updateVolume = useStore((s) => s.updateVolume);
  const updateRange = useStore((s) => s.updateRange);
  const printCfg = useStore((s) => s.presets.print.current);
  const mode = useStore((s) => s.mode);
  const [search, setSearch] = useState('');
  const vol = volumeId ? o?.volumes.find((v) => v.id === volumeId) : undefined;
  const range = rangeId ? o?.ranges.find((r) => r.id === rangeId) : undefined;
  const forVolume = !!vol;
  const candidates = useMemo(() => {
    if (!schema) return [];
    return schema.presetKeys.print
      .filter(
        (k) => !OBJECT_SETTING_EXCLUDES.has(k) && schema.options[k] && MODE_RANK[schema.options[k].mode || 'expert'] <= MODE_RANK[mode],
      )
      .filter((k) => !forVolume || !OBJECT_ONLY_PREFIXES.some((p) => k.startsWith(p)))
      .filter((k) => !search || k.includes(search.toLowerCase()) || schema.options[k].label.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => schema.options[a].label.localeCompare(schema.options[b].label));
  }, [schema, search, mode, forVolume]);
  // the schema is loaded before a dialog can open (App waits for `ready`)
  if (!o || !schema) return null;
  const config = vol ? vol.config : range ? range.config : o.config;
  const setConfig = (c: Record<string, string>) => {
    if (range) {
      updateRange(o.id, range.id, { config: c });
      return;
    }
    useStore.getState().recordHistory();
    if (vol) updateVolume(o.id, vol.id, { config: c });
    else updateObject(o.id, { config: c });
  };
  const keys = Object.keys(config);
  const title = vol
    ? `${vol.type === 'ParameterModifier' ? 'Modifier' : 'Part'} settings – ${vol.name} (${o.name})`
    : range
      ? `Height range ${range.minZ}–${range.maxZ} mm – ${o.name}`
      : `Per-object settings – ${o.name}`;
  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="object-settings">
        <div className="object-settings-list">
          <input placeholder="Add setting… (search)" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ul>
            {candidates.slice(0, 200).map((k) => (
              <li
                key={k}
                className={config[k] !== undefined ? 'added' : ''}
                onClick={() => config[k] === undefined && setConfig({ ...config, [k]: printCfg[k] ?? schema.options[k].default })}
              >
                <span>{schema.options[k].label}</span>
                <span className="muted small">{schema.options[k].category}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="object-settings-values">
          {!keys.length && (
            <div className="muted">No overrides. Pick a setting on the left to override it for this {vol ? 'volume' : 'object'} only.</div>
          )}
          {keys.map((k) => {
            const def = schema.options[k];
            if (!def) return null;
            return (
              <div key={k} className="override-row">
                <OptionField
                  def={def}
                  value={config[k]}
                  savedValue={printCfg[k]}
                  extruders={1}
                  onChange={(v) => setConfig({ ...config, [k]: v })}
                  onReset={() => setConfig({ ...config, [k]: printCfg[k] ?? def.default })}
                />
                <button
                  className="icon"
                  title="Remove override"
                  aria-label="Remove override"
                  onClick={() => {
                    const c = { ...config };
                    delete c[k];
                    setConfig(c);
                  }}
                >
                  <ACTION_ICONS.remove size={14} strokeWidth={2} aria-hidden="true" focusable="false" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
