import { useState, type ReactNode } from 'react';
import { importFiles } from '../importFiles';

export function DropZone({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`dropzone ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files?.length) void importFiles(e.dataTransfer.files);
      }}
    >
      {children}
      {over && <div className="drop-overlay">Drop STL / OBJ / 3MF / AMF files here</div>}
    </div>
  );
}
