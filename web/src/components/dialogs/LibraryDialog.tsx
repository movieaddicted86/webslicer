import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { libraryApi, type LibraryEntry } from '../../api';
import { importFiles } from '../../importFiles';
import { Modal } from './Modal';

export type LibraryMode = 'open' | 'saveProject' | 'saveGcode';

function fmtSize(n?: number) {
  if (n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
function fmtDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ICONS: Record<string, string> = { model: '◆', project: '🗂', gcode: '⚙', other: '·' };

export function LibraryDialog({ onClose, mode }: { onClose: () => void; mode: LibraryMode }) {
  const toast = useStore((s) => s.toast);
  const job = useStore((s) => s.job);
  const objects = useStore((s) => s.objects);
  const buildSliceRequest = useStore((s) => s.buildSliceRequest);
  const [path, setPath] = useState(() => {
    try {
      return localStorage.getItem('webslicer.libraryPath') || '';
    } catch {
      return '';
    }
  });
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState(() =>
    mode === 'saveGcode' ? job?.outputName || 'print.gcode' : (objects[0]?.name?.replace(/\.[^.]+$/, '') || 'project') + '.3mf',
  );
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      setError('');
      try {
        const r = await libraryApi.list(p);
        setEntries(r.entries);
        setRoot(r.root);
        setPath(r.path);
        try {
          localStorage.setItem('webslicer.libraryPath', r.path);
        } catch {
          /* ignore */
        }
      } catch (e) {
        setError((e as Error).message);
        if (p) load('');
      } finally {
        setLoading(false);
      }
    },
    [],
  );
  useEffect(() => {
    load(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crumbs = path ? path.split('/') : [];
  const open = async (e: LibraryEntry) => {
    if (e.dir) return load(e.path);
    if (e.kind === 'model' || e.kind === 'project') {
      setBusy(true);
      try {
        const blob = await libraryApi.fetchFile(e.path);
        await importFiles([new File([blob], e.name)]);
        toast('success', `Loaded ${e.name} from the library`);
        onClose();
      } catch (err) {
        toast('error', (err as Error).message);
      } finally {
        setBusy(false);
      }
    } else if (e.kind === 'gcode') {
      location.href = libraryApi.fileUrl(e.path, true);
    }
  };
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (mode === 'saveProject') {
        const req = buildSliceRequest();
        if (!req.objects.length) throw new Error('No objects to save (still uploading?)');
        const r = await libraryApi.saveProject(path, name.trim(), req);
        toast('success', `Project saved: ${r.path}`);
      } else if (mode === 'saveGcode' && job) {
        const r = await libraryApi.saveGcode(job.id, path, name.trim());
        toast('success', `G-code saved: ${r.path}`);
      }
      onClose();
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mkdir = async () => {
    const n = prompt('New folder name');
    if (!n) return;
    try {
      await libraryApi.mkdir(path, n);
      load(path);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const remove = async (e: LibraryEntry) => {
    if (!confirm(`Delete ${e.name}?`)) return;
    try {
      await libraryApi.remove(e.path);
      load(path);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const upload = async (files: FileList) => {
    setBusy(true);
    try {
      for (const f of Array.from(files)) await libraryApi.upload(path ? `${path}/${f.name}` : f.name, await f.arrayBuffer());
      load(path);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'open' ? 'Library – open model or project' : mode === 'saveProject' ? 'Library – save project (3MF)' : 'Library – save G-code';
  const shown = entries.filter((e) => e.dir || mode === 'open' || (mode === 'saveProject' ? e.kind === 'project' : e.kind === 'gcode'));

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="library">
        <div className="library-bar">
          <div className="crumbs">
            <button className={!path ? 'active' : ''} onClick={() => load('')}>
              Library
            </button>
            {crumbs.map((c, i) => (
              <span key={i}>
                <span className="muted"> / </span>
                <button className={i === crumbs.length - 1 ? 'active' : ''} onClick={() => load(crumbs.slice(0, i + 1).join('/'))}>
                  {c}
                </button>
              </span>
            ))}
          </div>
          <div className="tools">
            <button onClick={mkdir} title="New folder">
              📁+
            </button>
            <button onClick={() => fileRef.current?.click()} title="Upload files into this folder">
              ⤒ Upload
            </button>
            <button onClick={() => load(path)} title="Refresh">
              ⟳
            </button>
            <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={(e) => e.target.files && upload(e.target.files)} />
          </div>
        </div>
        {error && <div className="error small">{error}</div>}
        <ul className="library-list">
          {shown.map((e) => (
            <li key={e.path} className={`${e.dir ? 'dir' : e.kind || ''}`} onDoubleClick={() => open(e)}>
              <span className="icon">{e.dir ? '📁' : ICONS[e.kind || 'other']}</span>
              <span className="name" onClick={() => (e.dir || mode === 'open' ? open(e) : setName(e.name))} title={e.path}>
                {e.name}
              </span>
              <span className="muted small">{e.dir ? '' : fmtSize(e.size)}</span>
              <span className="muted small">{fmtDate(e.mtime)}</span>
              {!e.dir && mode === 'open' && (e.kind === 'model' || e.kind === 'project') && (
                <button className="small" onClick={() => open(e)} disabled={busy}>
                  Open
                </button>
              )}
              {!e.dir && e.kind === 'gcode' && (
                <a className="button small" href={libraryApi.fileUrl(e.path, true)} download>
                  ⤓
                </a>
              )}
              <button className="icon" title="Delete" onClick={() => remove(e)}>
                🗑
              </button>
            </li>
          ))}
          {!shown.length && !loading && (
            <li className="empty muted">
              {mode === 'open'
                ? `Empty. Copy STL / OBJ / 3MF / AMF files into the library folder (${root || 'LIBRARY_DIR'}) or upload them here.`
                : 'No matching files in this folder.'}
            </li>
          )}
        </ul>
        {mode !== 'open' && (
          <div className="modal-actions">
            <span className="muted small">Save in /{path}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} style={{ width: 260 }} />
            <button className="primary" onClick={save} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
