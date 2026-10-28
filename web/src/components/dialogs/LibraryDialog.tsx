import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store';
import { libraryApi, type LibraryEntry } from '../../api';
import { importFiles } from '../../importFiles';
import { fmtSize } from '../../format';
import { modsOf, selectionAfterClick, type ClickMods } from '../../selection';
import { Modal } from './Modal';
import './LibraryDialog.css';
import { Icon } from '../../icons/Icon';

export type LibraryMode = 'open' | 'saveProject' | 'saveGcode';

function fmtDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The file kind of a row; G-code draws PrusaSlicer's export icon, so no cog stands for a file */
const GLYPHS: Record<string, string> = { model: '◆', project: '🗂', other: '·' };
const KIND_ICON = { gcode: 'export' } as const;

/** A file a "Load all" imports; a G-code is downloaded on its own and cannot join a load. */
const loadable = (e: LibraryEntry): boolean => !e.dir && (e.kind === 'model' || e.kind === 'project');

/**
 * The file library (open a model or project, save a project or a G-code).
 *
 * A row keeps the flows it had: the name, the Open button, a plain click on the row body and Enter
 * open a file, a folder opens on a click. On top of that the row selects: the checkbox (shown on
 * hover, or while a selection exists) and a Ctrl/Cmd click add and remove single files, and a Shift
 * click selects the range from the row the last click landed on. The rules are the object list's
 * (`selection.ts`), run over the rows the user sees, so both lists behave the same way. Folders are
 * never part of a multiple selection – the group actions are about files. The arrow keys walk the
 * rows and take the row they land on, Space toggles it, Enter opens it.
 *
 * The bar above the list carries the actions of a selection. "Load all" imports the selected files in
 * one go, which is one undoable step and one dialog close. "Delete" asks once for the whole selection
 * and then deletes file by file, because the API has no bulk endpoint; the files that failed are
 * named back instead of stopping the rest.
 */
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
  // the selected files (by path) and the row a Shift range starts from
  const [selection, setSelection] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  // a click opens a file, and a double click is two clicks: the second one must not import it twice
  const opening = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError('');
    setSelection([]);
    anchor.current = null;
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
      if (p) void load('');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(path);
    // the initial listing only: the dialog is remounted per open, later loads come from `open`/`up`
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const crumbs = path ? path.split('/') : [];
  const shown = entries.filter((e) => e.dir || mode === 'open' || (mode === 'saveProject' ? e.kind === 'project' : e.kind === 'gcode'));
  // the rows a Shift range may cover: the files in the order the user sees them, never the folders
  const order = shown.filter((e) => !e.dir).map((e) => e.path);
  const selectedEntries = shown.filter((e) => selection.includes(e.path));
  const loadableCount = selectedEntries.filter(loadable).length;

  const open = async (e: LibraryEntry) => {
    if (e.dir) return load(e.path);
    if (e.kind === 'model' || e.kind === 'project') {
      if (opening.current) return;
      opening.current = true;
      setBusy(true);
      try {
        const blob = await libraryApi.fetchFile(e.path);
        await importFiles([new File([blob], e.name)]);
        toast('success', `Loaded ${e.name} from the library`);
        onClose();
      } catch (err) {
        toast('error', (err as Error).message);
      } finally {
        opening.current = false;
        setBusy(false);
      }
    } else if (e.kind === 'gcode') {
      location.href = libraryApi.fileUrl(e.path, true);
    }
  };
  /** A click on a file row: the shared rule decides what plain, Ctrl/Cmd and Shift mean. */
  const selectRow = (clicked: string, mods: ClickMods) => {
    const next = selectionAfterClick(order, selection, anchor.current, clicked, mods);
    anchor.current = next.anchor;
    setSelection(next.ids);
  };
  const loadAll = async () => {
    const chosen = selectedEntries.filter(loadable);
    if (!chosen.length) return;
    setBusy(true);
    const files: File[] = [];
    const failed: string[] = [];
    for (const e of chosen) {
      try {
        const blob = await libraryApi.fetchFile(e.path);
        files.push(new File([blob], e.name));
      } catch {
        failed.push(e.name);
      }
    }
    try {
      if (files.length) {
        await importFiles(files);
        toast('success', `Loaded ${files.length} ${files.length === 1 ? 'file' : 'files'} from the library`);
      }
      if (failed.length) toast('error', `Could not load: ${failed.join(', ')}`);
      if (files.length) onClose();
    } finally {
      setBusy(false);
    }
  };
  const removeSelected = async () => {
    if (!selectedEntries.length) return;
    const names = selectedEntries.map((e) => e.name);
    const ask =
      selectedEntries.length === 1
        ? `Delete ${names[0]} permanently?`
        : `Delete these ${selectedEntries.length} files permanently?\n\n${names.join('\n')}`;
    if (!confirm(ask)) return;
    setBusy(true);
    const failed: LibraryEntry[] = [];
    for (const e of selectedEntries) {
      try {
        await libraryApi.remove(e.path);
      } catch {
        failed.push(e);
      }
    }
    await load(path);
    // keep what could not be deleted selected, so a retry is one click away
    setSelection(failed.map((e) => e.path));
    if (failed.length) toast('error', `Could not delete: ${failed.map((e) => e.name).join(', ')}`);
    else toast('success', `Deleted ${selectedEntries.length} ${selectedEntries.length === 1 ? 'file' : 'files'}`);
    setBusy(false);
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
      void load(path);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const remove = async (e: LibraryEntry) => {
    if (!confirm(`Delete ${e.name}?`)) return;
    try {
      await libraryApi.remove(e.path);
      void load(path);
    } catch (err) {
      toast('error', (err as Error).message);
    }
  };
  const upload = async (files: FileList) => {
    setBusy(true);
    try {
      for (const f of Array.from(files)) await libraryApi.upload(path ? `${path}/${f.name}` : f.name, await f.arrayBuffer());
      void load(path);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Arrow keys walk the rows and pick the row they land on; Space toggles, Enter opens. */
  const onRowKey = (ev: React.KeyboardEvent<HTMLLIElement>, e: LibraryEntry) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      const rows = Array.from(ev.currentTarget.closest('ul')?.querySelectorAll<HTMLElement>('[data-testid="library-row"]') || []);
      const i = rows.indexOf(ev.currentTarget);
      const j = Math.min(rows.length - 1, Math.max(0, i + (ev.key === 'ArrowDown' ? 1 : -1)));
      rows[j]?.focus();
      const next = shown[j];
      if (next && !next.dir) selectRow(next.path, { ctrl: false, shift: false });
      return;
    }
    if (ev.target !== ev.currentTarget) return;
    if (ev.key === ' ') {
      ev.preventDefault();
      if (e.dir) return open(e);
      selectRow(e.path, { ctrl: true, shift: false });
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (e.dir || mode === 'open') void open(e);
      else setName(e.name);
    }
  };

  const title =
    mode === 'open' ? 'Library – open model or project' : mode === 'saveProject' ? 'Library – save project (3MF)' : 'Library – save G-code';

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
            <button onClick={mkdir} title="New folder" aria-label="New folder">
              <Icon name="folderPlus" size={16} />
            </button>
            <button onClick={() => fileRef.current?.click()} title="Upload files into this folder">
              <Icon name="upload" size={16} /> Upload
            </button>
            <button onClick={() => load(path)} title="Refresh" aria-label="Refresh">
              <Icon name="refresh" size={16} />
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              // T-092: the system file picker offers the formats the plater reads, so a phone's picker
              // does not list photos and music next to the models
              accept=".stl,.obj,.3mf,.amf,.step,.stp,.gcode,.bgcode"
              style={{ display: 'none' }}
              onChange={(e) => {
                if (e.target.files) void upload(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
        </div>
        {selection.length > 0 && (
          <div className="library-actions" data-testid="library-selection">
            <span className="muted small">{selectedEntries.length} selected</span>
            {mode === 'open' && (
              <button className="primary small" data-testid="library-load-all" onClick={loadAll} disabled={busy || !loadableCount}>
                Load all
              </button>
            )}
            <button data-testid="library-delete-selected" onClick={removeSelected} disabled={busy}>
              Delete selected
            </button>
            <button onClick={() => setSelection([])} disabled={busy}>
              Clear
            </button>
          </div>
        )}
        {error && <div className="error small">{error}</div>}
        <ul className={`library-list${selection.length ? ' has-selection' : ''}`} data-testid="library-list">
          {shown.map((e) => {
            const isSelected = selection.includes(e.path);
            return (
              <li
                key={e.path}
                className={`${e.dir ? 'dir' : e.kind || ''}${selection.includes(e.path) ? ' selected' : ''}`}
                data-testid="library-row"
                data-path={e.path}
                role="button"
                aria-pressed={e.dir ? undefined : selection.includes(e.path)}
                tabIndex={0}
                title={e.dir ? `Open folder ${e.name}` : e.name}
                onClick={(ev) => {
                  // the row's own buttons, the download link and the checkbox keep their click
                  if ((ev.target as HTMLElement).closest('button, a, input')) return;
                  const mods = modsOf(ev);
                  // a plain click keeps today's flow – open in the open mode, take the name in a save
                  // mode; the modifiers are what select a file for a group action
                  if (mods.ctrl || mods.shift) selectRow(e.path, mods);
                  else if (mode === 'open' || e.dir) void open(e);
                  else setName(e.name);
                }}
                onKeyDown={(ev) => onRowKey(ev, e)}
              >
                {e.dir ? (
                  <span className="lib-check" aria-hidden="true" />
                ) : (
                  <input
                    type="checkbox"
                    className="lib-check"
                    data-testid="library-check"
                    checked={isSelected}
                    tabIndex={-1}
                    aria-label={`Select ${e.name}`}
                    onChange={() => selectRow(e.path, { ctrl: true, shift: false })}
                    onClick={(ev) => ev.stopPropagation()}
                  />
                )}
                <span className="icon">
                  {e.dir ? '📁' : e.kind === 'gcode' ? <Icon name={KIND_ICON.gcode} size={14} /> : GLYPHS[e.kind || 'other']}
                </span>
                <span className="name" title={e.path}>
                  {e.name}
                </span>
                <span className="muted small lib-size">{e.dir ? '' : fmtSize(e.size)}</span>
                <span className="muted small lib-date">{fmtDate(e.mtime)}</span>
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
                <button className="icon" title="Delete" aria-label="Delete" onClick={() => remove(e)}>
                  <Icon name="delete" size={14} />
                </button>
              </li>
            );
          })}
          {!shown.length && !loading && (
            <li className="empty muted">
              {mode === 'open'
                ? `Empty. Copy STL / OBJ / 3MF / AMF files into the library folder (${root || 'LIBRARY_DIR'}) or upload them here.`
                : 'No matching files in this folder.'}
            </li>
          )}
        </ul>
        {mode !== 'open' && (
          <div className="modal-actions" data-testid="modal-actions">
            <span className="muted small">Save in /{path}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              className="lib-save-name"
            />
            <button className="primary" data-testid="modal-primary" onClick={save} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
