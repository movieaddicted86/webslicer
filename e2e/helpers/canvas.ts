/**
 * What the browser sees on the canvas – the t17 probes, ported unchanged in spirit.
 *
 * Three tools:
 *  - a **camera tap**: three.js announces renderers and scenes on `__THREE_DEVTOOLS__`; the probe
 *    records them, picks the live viewer renderer (React StrictMode mounts a discarded one first) and
 *    patches its `render` to keep the camera of the last frame. Projecting known world points through
 *    that camera answers "is the object inside the picture, centred, framed" exactly, without
 *    depending on lighting or pixels.
 *  - a **pixel classifier** over an 8-bit canvas screenshot: the plate mask, warm object pixels,
 *    saturated toolpath pixels and red gizmo blobs. It turns "what is drawn" into numbers.
 *  - **scene probes**: the G-code group's drawn segment counts, the bed outline vertex count, the
 *    visible meshes of the "Shells" mode and the WebGL resource census.
 *
 * All of it runs in the page; the helpers below only carry the numbers back.
 */
import type { Page } from '@playwright/test';
import type { SceneChildLike, SceneLike } from './store-types';

/** Install the devtools capture and the two pickers. Must run before the page loads. */
export async function installCanvasProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__wsObserved = { renderers: [], scenes: [] };
    window.__THREE_DEVTOOLS__.addEventListener('observe', (e) => {
      const o = (e as CustomEvent).detail;
      if (o && o.isWebGLRenderer) window.__wsObserved?.renderers.push(o);
      else if (o && o.isScene) window.__wsObserved?.scenes.push(o);
    });
    // React StrictMode mounts the viewer twice, so the first renderer is a discarded one: take the
    // last renderer that has drawn with an opaque clear (the thumbnail renderer clears with alpha 0)
    window.__wsMain = () => {
      const scenes = window.__wsObserved?.renderers ?? [];
      const live = scenes.filter((r) => {
        const renderer = r as { info: { programs?: unknown[] }; getClearAlpha: () => number };
        return renderer.info.programs?.length && renderer.getClearAlpha() === 1;
      });
      return (live.at(-1) ?? scenes.at(-1)) as ReturnType<NonNullable<Window['__wsMain']>>;
    };
    window.__wsScene = () => {
      const hasGcode = (s: SceneLike) => {
        let found = false;
        s.traverse((o) => {
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          if (o.isLineSegments && m?.vertexColors) found = true;
        });
        return found;
      };
      const all = (window.__wsObserved?.scenes ?? []) as SceneLike[];
      return (all.filter(hasGcode).at(-1) ?? all.filter((s) => s.children.length >= 4).at(-1) ?? all.at(-1)) as ReturnType<
        NonNullable<Window['__wsScene']>
      >;
    };
  });
}

/** Patch the live renderer once so every frame records its camera and the two matrices. */
export async function tapCamera(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const r = window.__wsMain();
    if (!r) return false;
    const tapped = r as typeof r & { __tapped?: boolean };
    if (tapped.__tapped) return true;
    const orig = r.render.bind(r);
    r.render = (scene, camera) => {
      const c = camera as { projectionMatrix: { elements: number[] }; matrixWorldInverse: { elements: number[] } };
      window.__wsCamera = {
        camera,
        scene,
        proj: c.projectionMatrix.elements.slice(),
        inv: c.matrixWorldInverse.elements.slice(),
      };
      return orig(scene, camera);
    };
    tapped.__tapped = true;
    return true;
  });
}

/** Where the three.js development hooks were found – a false result means the probe never attached. */
export async function hasCanvas(page: Page): Promise<boolean> {
  return page.evaluate(() => !!window.__wsMain());
}

export type Vec3 = [number, number, number];
/** NDC coordinates per point (null when behind the camera). */
export type Projected = Array<[number, number] | null>;

/** Project world points through the camera of the last rendered frame. */
export async function project(page: Page, points: Vec3[]): Promise<Projected | null> {
  return page.evaluate((pts) => {
    const c = window.__wsCamera;
    if (!c) return null;
    const mul = (m: number[], v: number[]) => [
      m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
      m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
      m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
      m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
    ];
    return pts.map((p) => {
      const v = mul(c.inv, [p[0], p[1], p[2], 1]);
      const cl = mul(c.proj, v);
      if (!(cl[3] > 0)) return null;
      return [cl[0] / cl[3], cl[1] / cl[3]] as [number, number];
    });
  }, points);
}

/** A projected bounding box `[minX, minY, maxX, maxY]` in NDC, or null when no point is visible. */
export type NdcBox = [number, number, number, number] | null;

export interface FrameProbe {
  bed: NdcBox;
  objects: NdcBox;
  behind: number;
  note?: string;
}

const r6 = (v: number): number => Number(v.toFixed(6));

/** The projected boxes of the bed corners and of every instance centre. */
export async function frameProbe(page: Page): Promise<FrameProbe> {
  const p = await page.evaluate(() => {
    const s = window.webslicer.getState();
    const shape = (s.presets.printer.current.bed_shape || '0x0,200x0,200x200,0x200').split(',');
    const bed = shape.map((part) => {
      const [x, y] = part.split('x').map(Number);
      return [x, y, 0] as [number, number, number];
    });
    const objects: Vec3[] = [];
    for (const o of s.objects) for (const i of o.instances) objects.push([i.position[0], i.position[1], i.position[2] + o.size[2] / 2]);
    return { bed, objects };
  });
  const all: Vec3[] = [...p.bed, ...p.objects];
  const ndc = await project(page, all);
  if (!ndc) return { bed: null, objects: null, behind: 0, note: 'no camera tap' };
  const bed = ndc.slice(0, p.bed.length);
  const objects = ndc.slice(p.bed.length);
  const box = (list: Projected): NdcBox => {
    const xs = list.filter((v): v is [number, number] => v !== null).map((v) => v[0]);
    const ys = list.filter((v): v is [number, number] => v !== null).map((v) => v[1]);
    return xs.length ? [r6(Math.min(...xs)), r6(Math.min(...ys)), r6(Math.max(...xs)), r6(Math.max(...ys))] : null;
  };
  return { bed: box(bed), objects: box(objects), behind: ndc.filter((v) => v === null).length };
}

export interface CanvasAnalysis {
  /** mean luminance per cell of a 24×24 raster */
  grid: number[][];
  satCount: number;
  brightCount: number;
  plateCount: number;
  warmCount: number;
  sat: [number, number, number, number] | null;
  red: Array<{ count: number; centre: [number, number] }>;
}

/**
 * Classify the canvas pixels. Runs in the page (it needs a canvas to decode the screenshot).
 *
 * `warmCount` counts pixels whose red channel is clearly above the blue one – the plater object and
 * the gizmo are warm, the bed and the UI are not. `plateCount` is the exact plate colour, `brightCount`
 * the bright chromatic toolpath colours. `red` blobs are the gizmo handles.
 */
const ANALYSE = async (b64: string): Promise<CanvasAnalysis> => {
  // everything this function needs is defined inside it: `page.evaluate` serialises the source only,
  // so a reference to a module-level helper would be undefined in the page
  const round = (v: number) => Number(v.toFixed(6));
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d canvas context');
  ctx.drawImage(img, 0, 0);
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h).data;
  const hue = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    if (mx === mn) return 0;
    const dd = mx - mn;
    const hh = mx === r ? ((g - b) / dd) % 6 : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    return (((hh * 60) % 360) + 360) % 360;
  };
  const sat = (r: number, g: number, b: number) => {
    const mx = Math.max(r, g, b);
    return mx ? (mx - Math.min(r, g, b)) / mx : 0;
  };
  const red = new Uint8Array(w * h);
  const saturated = new Uint8Array(w * h);
  let satCount = 0;
  let brightCount = 0;
  let plateCount = 0;
  let warmCount = 0;
  const N = 24;
  const sums = new Float64Array(N * N);
  const counts = new Float64Array(N * N);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(N - 1, Math.floor((y * N) / h));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const r = d[o];
      const g = d[o + 1];
      const b = d[o + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const gi = gy * N + Math.min(N - 1, Math.floor((x * N) / w));
      sums[gi] += 0.299 * r + 0.587 * g + 0.114 * b;
      counts[gi]++;
      if (Math.abs(r - 42) < 5 && Math.abs(g - 46) < 5 && Math.abs(b - 53) < 5) plateCount++;
      if (r - b > 8) warmCount++;
      const s = sat(r, g, b);
      const hu = hue(r, g, b);
      if (s > 0.3 && mx > 30) {
        saturated[i] = 1;
        satCount++;
        if (mx > 150 && mx - mn > 40) brightCount++;
      }
      if (s > 0.5 && (hu < 14 || hu > 346) && mx > 60) red[i] = 1;
    }
  }
  const grid: number[][] = [];
  for (let gy = 0; gy < N; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < N; gx++) row.push(Math.round(sums[gy * N + gx] / counts[gy * N + gx]));
    grid.push(row);
  }
  const blobsOf = (mask: Uint8Array, minPx = 40) => {
    const seen = new Uint8Array(w * h);
    const blobs: Array<{ count: number; box: [number, number, number, number] }> = [];
    for (let start = 0; start < w * h; start++) {
      if (!mask[start] || seen[start]) continue;
      const stack = [start];
      seen[start] = 1;
      let count = 0;
      const box: [number, number, number, number] = [w, h, -1, -1];
      while (stack.length) {
        const p = stack.pop() as number;
        const x = p % w;
        const y = (p / w) | 0;
        count++;
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
        for (const n of [p - 1, p + 1, p - w, p + w]) {
          if (n < 0 || n >= w * h || seen[n] || !mask[n]) continue;
          if (Math.abs((n % w) - x) > 1) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (count >= minPx) blobs.push({ count, box });
    }
    return blobs.sort((a, b) => b.count - a.count);
  };
  const union = (blobs: Array<{ box: [number, number, number, number] }>): [number, number, number, number] | null => {
    if (!blobs.length) return null;
    const b: [number, number, number, number] = [w, h, -1, -1];
    for (const bl of blobs) {
      b[0] = Math.min(b[0], bl.box[0]);
      b[1] = Math.min(b[1], bl.box[1]);
      b[2] = Math.max(b[2], bl.box[2]);
      b[3] = Math.max(b[3], bl.box[3]);
    }
    return b;
  };
  const frac = (b: [number, number, number, number] | null): [number, number, number, number] | null =>
    b ? [round(b[0] / w), round(b[1] / h), round(b[2] / w), round(b[3] / h)] : null;
  return {
    grid,
    satCount,
    brightCount,
    plateCount,
    warmCount,
    sat: frac(union(blobsOf(saturated))),
    red: blobsOf(red, 15).map((b) => ({
      count: b.count,
      centre: [Math.round((b.box[0] + b.box[2]) / 2), Math.round((b.box[1] + b.box[3]) / 2)],
    })),
  };
};

const OVERLAYS = ['.viewer-toolbar', '.viewer-hint', '.viewer-fit', '.toasts', '[data-testid="tool-strip"]', '[data-testid="tool-panel"]'];

/** Screenshot of the canvas with the overlays hidden, so a tooltip or a toast cannot change a count. */
export async function shot(page: Page): Promise<CanvasAnalysis> {
  await page.evaluate((sels) => {
    for (const sel of sels) for (const el of document.querySelectorAll<HTMLElement>(sel)) el.style.visibility = 'hidden';
  }, OVERLAYS);
  const b64 = (await page.locator('.viewer canvas').screenshot()).toString('base64');
  const analysis = await page.evaluate(ANALYSE, b64);
  await page.evaluate((sels) => {
    for (const sel of sels) for (const el of document.querySelectorAll<HTMLElement>(sel)) el.style.visibility = '';
  }, OVERLAYS);
  return analysis;
}

/** Canvas centre of the largest red blob (a gizmo handle), in CSS pixels relative to the canvas. */
export async function gizmoHandle(page: Page): Promise<{ x: number; y: number; count: number } | null> {
  const a = await shot(page);
  const blob = a.red[0];
  return blob ? { x: blob.centre[0], y: blob.centre[1], count: blob.count } : null;
}

export interface GcodeScene {
  segs: number;
  travel: number;
  points: number;
  drawn: number;
  /** segments drawn as a point: how the viewer hides one feature type */
  collapsed: number;
}

/**
 * What the G-code group draws. The sliders and the feature toggles never rebuild geometry: they move
 * `geometry.drawRange` (and collapse hidden segments to zero length), so the drawn counts are the
 * observable. The group is the scene child with the most line/point vertices.
 */
export async function gcodeScene(page: Page): Promise<GcodeScene> {
  return page.evaluate(() => {
    const scene = window.__wsScene();
    let group: SceneChildLike | null = null;
    let best = 0;
    for (const child of scene.children) {
      let pts = 0;
      child.traverse((o) => {
        if (o.isLineSegments || o.isPoints) pts += o.geometry?.attributes?.position?.count ?? 0;
      });
      if (pts > best) {
        best = pts;
        group = child;
      }
    }
    if (!group) return { segs: 0, travel: 0, points: 0, drawn: 0, collapsed: 0 };
    let segs = 0;
    let travel = 0;
    let points = 0;
    let collapsed = 0;
    group.traverse((o) => {
      if (!o.visible || !o.geometry) return; // the group also holds the tool marker (a Mesh)
      const dr = o.geometry.drawRange;
      const pos = o.geometry.attributes.position;
      const material = Array.isArray(o.material) ? o.material[0] : o.material;
      if (o.isLineSegments) {
        const n = Math.min(dr.count, pos.count);
        if (material?.vertexColors) segs += n / 2;
        else travel += n / 2;
        const a = pos.array;
        for (let i = dr.start; i < dr.start + n; i += 2) {
          const o1 = i * 3;
          const o2 = (i + 1) * 3;
          if (a[o1] === a[o2] && a[o1 + 1] === a[o2 + 1] && a[o1 + 2] === a[o2 + 2]) collapsed++;
        }
      } else if (o.isPoints) points += Math.min(dr.count, pos.count);
    });
    return { segs, travel, points, drawn: segs + travel + points, collapsed };
  });
}

export interface MarkerProbe {
  drawn: number;
  total: number;
  move: number[];
}

/** The drawn point count of the marker kind that is switched on, with the marker's move indices. */
export async function markerKindProbe(page: Page): Promise<MarkerProbe | null> {
  return page.evaluate(() => {
    const scene = window.__wsScene();
    let group: SceneChildLike | null = null;
    let best = 0;
    for (const child of scene.children) {
      let pts = 0;
      child.traverse((o) => {
        if (o.isLineSegments || o.isPoints) pts += o.geometry?.attributes?.position?.count ?? 0;
      });
      if (pts > best) {
        best = pts;
        group = child;
      }
    }
    if (!group) return null;
    let found: SceneChildLike | null = null;
    group.traverse((o) => {
      if (!found && o.isPoints && o.visible) found = o;
    });
    if (!found) return null;
    const points = found as SceneChildLike;
    const move = Array.from(points.userData.move ?? []);
    const geometry = points.geometry as NonNullable<SceneChildLike['geometry']>;
    return { drawn: geometry.drawRange.count, total: move.length, move };
  });
}

/** Visible plater meshes (not the bed) and visible toolpath objects. */
export async function visibleMeshes(page: Page): Promise<{ meshes: number; toolpaths: number }> {
  return page.evaluate(() => {
    const scene = window.__wsScene();
    let meshes = 0;
    let toolpaths = 0;
    scene.traverse((o) => {
      let vis = true;
      let p: SceneChildLike | null = o;
      while (p) {
        if (!p.visible) vis = false;
        p = p.parent;
      }
      if (!vis) return;
      if (o.isMesh && o.name !== 'bed' && o.name !== 'bed-model' && o.name !== 'bed-texture') meshes++;
      if (o.isLine || o.isLineSegments) toolpaths++;
    });
    return { meshes, toolpaths };
  });
}

export interface Census {
  rendererMemory: { geometries: number; textures: number } | null;
  programs: number | null;
  scene: { geometries: number; materialKeys: number; textures: number; drawables: number; children: number };
}

/** WebGL resource census: what is live on the GPU plus the scene graph that references it. */
export async function census(page: Page): Promise<Census> {
  return page.evaluate(() => {
    const renderer = window.__wsMain();
    const scene = window.__wsScene();
    const geos = new Set<string>();
    const mats = new Set<string>();
    const texs = new Set<string>();
    let meshes = 0;
    scene.traverse((o) => {
      const geometry = o.geometry as (NonNullable<SceneChildLike['geometry']> & { uuid?: string }) | undefined;
      if (geometry) geos.add(geometry.uuid ?? '');
      if (o.isMesh || o.isLineSegments || o.isPoints || o.isLine) meshes++;
      const m = o.material;
      for (const mm of Array.isArray(m) ? m : m ? [m] : []) {
        const mat = mm as { type?: string; color?: { getHexString: () => string }; map?: { uuid: string } };
        mats.add(`${mat.type}:${mat.color ? mat.color.getHexString() : ''}:${mat.map ? mat.map.uuid : ''}`);
        for (const v of Object.values(mm as Record<string, unknown>)) {
          const tex = v as { isTexture?: boolean; uuid?: string } | null;
          if (tex && tex.isTexture && tex.uuid) texs.add(tex.uuid);
        }
      }
    });
    return {
      rendererMemory: renderer ? { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } : null,
      programs: renderer ? (renderer.info.programs?.length ?? null) : null,
      scene: { geometries: geos.size, materialKeys: mats.size, textures: texs.size, drawables: meshes, children: scene.children.length },
    };
  });
}

export interface BedOutline {
  outline: Array<[number, number]> | null;
  plateVerts?: number;
  plateTriangles?: number;
}

/** The bed outline (LineLoop) and plate mesh vertex counts of the scene. */
export async function bedOutline(page: Page): Promise<BedOutline> {
  return page.evaluate(() => {
    const scene = window.__wsScene();
    const out: { outline: Array<[number, number]> | null; plateVerts?: number; plateTriangles?: number } = { outline: null };
    scene.traverse((o) => {
      const geometry = o.geometry as (NonNullable<SceneChildLike['geometry']> & { index?: { count: number } | null }) | undefined;
      if (!geometry) return;
      if (o.isLineLoop && !out.outline) {
        const a = geometry.attributes.position.array;
        const pts: Array<[number, number]> = [];
        for (let i = 0; i < a.length; i += 3) pts.push([Math.round(a[i] * 1000) / 1000, Math.round(a[i + 1] * 1000) / 1000]);
        out.outline = pts;
      }
      if (o.isMesh && o.name === 'bed' && out.plateVerts === undefined) {
        const a = geometry.attributes.position.array;
        out.plateVerts = a.length / 3;
        out.plateTriangles = geometry.index ? geometry.index.count / 3 : a.length / 9;
      }
    });
    return out;
  });
}
