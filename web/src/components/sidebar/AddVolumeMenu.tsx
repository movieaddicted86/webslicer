import { useEffect, useRef, useState } from 'react';
import { useStore, VOLUME_LABELS, selectedInstance, type PlaterObject } from '../../state/store';
import { bedShapeOf } from '@webslicer/shared';
import { createPrimitive, type PrimitiveShape } from '../../three/primitives';
import { loadModelFile } from '../../three/loaders';
import { VOLUME_ICONS } from './volumes';
import type { VolumeType } from '../../api';

/** Popover to add a sub-volume to an object */
export function AddVolumeMenu({ o, onClose }: { o: PlaterObject; onClose: () => void }) {
  const addVolume = useStore((s) => s.addVolume);
  const toast = useStore((s) => s.toast);
  const bedShape = useStore((s) => s.presets.printer.current.bed_shape || '');
  const selectedIds = useStore((s) => s.selectedIds);
  const selectedInstanceId = useStore((s) => s.selectedInstanceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileType, setFileType] = useState<VolumeType>('ModelPart');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const bed = bedShapeOf({ bed_shape: bedShape });
  const side = Math.max(5, 0.1 * Math.max(bed.max[0] - bed.min[0], bed.max[1] - bed.min[1]));
  const objScale = selectedInstance({ selectedIds, selectedInstanceId }, o).scale;
  const objSize: [number, number, number] = [o.size[0] * objScale[0], o.size[1] * objScale[1], o.size[2] * objScale[2]];

  const addPrimitive = async (type: VolumeType, shape: PrimitiveShape) => {
    const geometry = createPrimitive(shape, side, [o.size[0], o.size[1], o.size[2]]);
    geometry.computeBoundingBox();
    const h = geometry.boundingBox!.max.z - geometry.boundingBox!.min.z;
    // modifiers etc. start at the object centre; slabs and new parts sit on the bed
    const position: [number, number, number] = shape === 'slab' || type === 'ModelPart' ? [0, 0, h / 2] : [0, 0, objSize[2] / 2 / objScale[2]];
    await addVolume(o.id, { name: `${VOLUME_LABELS[type]} ${shape}`, type, geometry, position });
    onClose();
  };
  const addFromFile = async (file: File) => {
    try {
      const models = await loadModelFile(file);
      for (const m of models) await addVolume(o.id, { name: m.name, type: fileType, geometry: m.geometry });
    } catch (e) {
      toast('error', (e as Error).message);
    }
    onClose();
  };
  const rows: Array<{ type: VolumeType; shapes: PrimitiveShape[] }> = [
    { type: 'ParameterModifier', shapes: ['box', 'cylinder', 'sphere', 'slab'] },
    { type: 'SupportEnforcer', shapes: ['box', 'cylinder', 'sphere', 'slab'] },
    { type: 'SupportBlocker', shapes: ['box', 'cylinder', 'sphere', 'slab'] },
    { type: 'NegativeVolume', shapes: ['box', 'cylinder', 'sphere'] },
    { type: 'ModelPart', shapes: ['box', 'cylinder', 'sphere'] },
  ];
  return (
    <div className="add-volume" ref={ref}>
      <div className="add-volume-title">Add to “{o.name}”</div>
      {rows.map((r) => (
        <div key={r.type} className="add-volume-row">
          <span className={`vtype ${r.type}`}>
            {VOLUME_ICONS[r.type]} {VOLUME_LABELS[r.type]}
          </span>
          <div>
            {r.shapes.map((s) => (
              <button key={s} onClick={() => addPrimitive(r.type, s)}>
                {s}
              </button>
            ))}
            <button
              onClick={() => {
                setFileType(r.type);
                fileRef.current?.click();
              }}
              title="Load a mesh file as this volume"
            >
              file…
            </button>
          </div>
        </div>
      ))}
      <input
        ref={fileRef}
        type="file"
        accept=".stl,.obj,.3mf,.amf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) addFromFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
