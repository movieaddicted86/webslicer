import { useRef, useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { importFiles } from '../importFiles';
import { SUPPORTED_EXTENSIONS } from '../three/loaders';
import { useMediaQuery } from './left/useMediaQuery';
import { Icon } from '../icons/Icon';
import './DropZone.css';

/** The width below which the phone's own way in is shown (the same number as the stylesheet). */
const PHONE_QUERY = '(max-width: 640px)';

/**
 * The scene's drop target. A file dragged onto the plate is imported, as it always was. On a phone
 * there is no drag, so an empty plater shows one card with the two ways in (T-092, P-02): the
 * system file picker with the formats the plater reads, and the file library – the same dialog the
 * rail's Library entry opens, so the flow's first step needs neither a menu nor a drawer.
 * The hidden input stays for both, so the card is a second trigger and not a second import path.
 */
export function DropZone({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const phone = useMediaQuery(PHONE_QUERY);
  const empty = useStore((s) => s.objects.length === 0);
  const openDialog = useStore((s) => s.openDialog);
  const openPicker = () => fileRef.current?.click();
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
      <input
        ref={fileRef}
        type="file"
        multiple
        className="dropzone-file"
        data-testid="dropzone-file"
        accept={SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
        onChange={(e) => {
          if (e.target.files?.length) void importFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {phone && empty && (
        <div className="dropzone-empty" data-testid="dropzone-empty">
          <div>Nothing on the plate yet.</div>
          <button type="button" className="primary" data-testid="dropzone-pick" onClick={openPicker}>
            <Icon name="import" size={16} />
            Choose a model…
          </button>
          {/* P-02: the library is the app's own way to a model the phone did not take a photo of
              – the same dialog its rail entry opens, never a second list */}
          <button type="button" className="secondary" data-testid="dropzone-library" onClick={() => openDialog('library', 'open')}>
            <Icon name="library" size={16} />
            From library
          </button>
        </div>
      )}
      {over && <div className="drop-overlay">Drop STL / OBJ / 3MF / AMF / STEP files here</div>}
    </div>
  );
}
