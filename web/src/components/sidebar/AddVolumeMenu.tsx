import { useEffect, useRef, useState } from 'react';
import { useStore, VOLUME_LABELS, type PlaterObject } from '../../state/store';
import { VOLUME_ICONS } from './volumes';
import type { PrimitiveShape } from '../../plater/meshOps';
import type { VolumeType } from '../../api';

/** Popover to add a sub-volume to an object */
export function AddVolumeMenu({ o, onClose }: { o: PlaterObject; onClose: () => void }) {
  const addPrimitiveVolume = useStore((s) => s.addPrimitiveVolume);
  const addVolumeFromFile = useStore((s) => s.addVolumeFromFile);
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

  const addPrimitive = async (type: VolumeType, shape: PrimitiveShape) => {
    await addPrimitiveVolume(o.id, type, shape);
    onClose();
  };
  const addFromFile = async (file: File) => {
    await addVolumeFromFile(o.id, file, fileType);
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
        accept=".stl,.obj,.3mf,.amf,.step,.stp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addFromFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
