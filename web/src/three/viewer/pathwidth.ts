/** Width of the preview's extrusion ribbons, derived from the G-code rather than a fixed line size. */
import * as THREE from 'three';

/** PrusaSlicer's common nozzle/extrusion width, used when a G-code has no usable `;WIDTH:` comment. */
export const FALLBACK_EXTRUSION_WIDTH = 0.45;
/** Even a thin extrusion stays recognisable when the camera is far away. */
export const MIN_TOOLPATH_PIXELS = 1.5;
/** Below this real path width, hairlines keep dense far-away views cheap. */
export const RIBBON_PIXEL_THRESHOLD = 3;
/** The vertex shader samples the position, the colour and the width texture. */
const RIBBON_SAMPLERS = 3;

/** Opt-in E2E baseline: `?testToolpaths=hairlines`; normal visits always use the adaptive renderer. */
export function toolpathMode(search: string): 'adaptive' | 'hairlines' {
  return new URLSearchParams(search).get('testToolpaths') === 'hairlines' ? 'hairlines' : 'adaptive';
}

/** Test hook: `?testRibbons=off` makes the ribbon renderer unavailable, so the hairline fallback shows. */
export function ribbonsEnabled(search: string): boolean {
  return new URLSearchParams(search).get('testRibbons') !== 'off';
}

/** A texture size in texels. */
export interface RibbonTextureLayout {
  width: number;
  height: number;
  /** the last row has free texels, so the texture holds a padded copy instead of the raw run */
  padded: boolean;
}

/**
 * The grid a run of `texelCount` texels is stored in. The width stays within the device limit and is
 * chosen so the rows divide the count exactly wherever the rows allow it – then the texture can read
 * the shared segment buffer in place. Otherwise the run is padded to whole rows with zeros. Null
 * means the run does not fit the device at all.
 */
export function wrapTextureLayout(texelCount: number, maxSize: number): RibbonTextureLayout | null {
  if (!Number.isInteger(texelCount) || texelCount <= 0 || !Number.isFinite(maxSize) || maxSize < 1) return null;
  if (texelCount <= maxSize) return { width: texelCount, height: 1, padded: false };
  for (let width = maxSize; width >= 1; width--) {
    if (texelCount % width === 0 && texelCount / width <= maxSize) return { width, height: texelCount / width, padded: false };
  }
  const height = Math.ceil(texelCount / maxSize);
  return height <= maxSize ? { width: maxSize, height, padded: true } : null;
}

/** Where a linear texel index lands in a wrapped run, row-major. */
export function texelAt(index: number, layout: RibbonTextureLayout): { x: number; y: number } {
  return { x: index % layout.width, y: Math.floor(index / layout.width) };
}

/** The two texels of one segment: its start at texel `2i`, its end at texel `2i + 1`. */
export function segmentTexels(
  segment: number,
  layout: RibbonTextureLayout,
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  return { start: texelAt(segment * 2, layout), end: texelAt(segment * 2 + 1, layout) };
}

/** The segment count a `size`-texel device holds when every segment needs two texels. */
export function maxRibbonSegments(size: number): number {
  const layout = wrapTextureLayout(size * size, size);
  return layout ? Math.floor((layout.width * layout.height) / 2) : 0;
}

/** The texture width the ribbons may use. The `testRibbonLimit` hook lowers it, so an E2E can prove it. */
export function ribbonTextureLimit(search: string, deviceMax: number): number {
  const value = Number(new URLSearchParams(search).get('testRibbonLimit'));
  return Number.isInteger(value) && value > 0 ? Math.min(value, deviceMax) : deviceMax;
}

/** Why the hairline renderer stays in charge. */
export interface RibbonSupport {
  usable: boolean;
  /** the texture width the device (or the test hook) allows */
  maxTextureSize: number;
  reason?: string;
}

/**
 * Whether a 1×1 RGB32F texture can be allocated: the only format the ribbon shader reads.
 *
 * This is the one place that touches raw WebGL, and it runs outside the render loop (the G-code is
 * built after a slice). The texture unit three.js last used still holds whatever it bound - on a
 * sliced plate that is the bed's vendor texture. Binding `null` there would leave the unit empty
 * while three.js's state cache still believes the bed texture is bound, so every later render skips
 * the bind and the sampler reads black: the bed turns black right after slicing (T-103). Put the
 * previous binding back instead, so the cache and the GPU stay in agreement.
 */
function floatTextureSupported(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const previous = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const texture = gl.createTexture();
  if (!texture) return false;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB32F, 1, 1, 0, gl.RGB, gl.FLOAT, new Float32Array(3));
  const ok = gl.getError() === gl.NO_ERROR;
  gl.bindTexture(gl.TEXTURE_2D, previous);
  gl.deleteTexture(texture);
  return ok;
}

/**
 * Can the ribbons draw this result? Too many segments, too few vertex texture units or a device
 * without float textures mean the Preview keeps its hairlines instead of drawing nothing. Never an
 * exception: an invisible sliced result is the worst outcome.
 */
export function ribbonSupport(renderer: THREE.WebGLRenderer, segmentCount: number, search: string): RibbonSupport {
  const maxTextureSize = ribbonTextureLimit(search, renderer.capabilities.maxTextureSize);
  const unsupported = (reason: string): RibbonSupport => ({ usable: false, maxTextureSize, reason });
  if (!ribbonsEnabled(search)) return unsupported('ribbons switched off by the test hook');
  if (segmentCount > maxRibbonSegments(maxTextureSize)) return unsupported(`${segmentCount} segments exceed the texture grid`);
  const gl = renderer.getContext();
  if ((gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number) < RIBBON_SAMPLERS) return unsupported('too few vertex texture units');
  if (!floatTextureSupported(renderer)) return unsupported('float textures are unavailable');
  return { usable: true, maxTextureSize };
}

/** The millimetres an extrusion ribbon spans; missing or invalid widths get the common fallback. */
export function extrusionWidth(width: number | undefined): number {
  return width !== undefined && Number.isFinite(width) && width > 0 ? width : FALLBACK_EXTRUSION_WIDTH;
}

/** World height at the camera target, shared by the perspective and orthographic preview. */
export function viewHeight(camera: THREE.Camera, target: THREE.Vector3): number {
  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera;
    return (ortho.top - ortho.bottom) / ortho.zoom;
  }
  const persp = camera as THREE.PerspectiveCamera;
  return 2 * persp.position.distanceTo(target) * Math.tan((persp.fov * Math.PI) / 360);
}

/** The G-code width converted to the world-width of a fat line, with a floor in screen pixels. */
export function toolpathWidth(width: number | undefined, millimetresPerPixel: number): number {
  return Math.max(extrusionWidth(width), MIN_TOOLPATH_PIXELS * millimetresPerPixel);
}

/** Real widths stay visible up close; dense distant layers use the cheaper hairline renderer. */
export function wideToolpaths(pixelsPerMillimetre: number, width: number): boolean {
  return extrusionWidth(width) * pixelsPerMillimetre >= RIBBON_PIXEL_THRESHOLD;
}

/** The CSS pixels one world millimetre covers on the current canvas (the shader uses CSS pixels). */
export function pixelsPerMillimetre(renderer: THREE.WebGLRenderer, camera: THREE.Camera, target: THREE.Vector3): number {
  return renderer.getSize(new THREE.Vector2()).y / viewHeight(camera, target);
}

/**
 * Instanced line segments with one world-width per extrusion. The colour buffer is shared with the
 * ordinary LineSegments geometry used for feature hiding, so recolouring never needs a second copy.
 */
export function ribbonGeometry(positions: Float32Array, colors: Float32Array, widths: Float32Array): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const vertices = new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0, -1, -1, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const segments = new THREE.InstancedInterleavedBuffer(positions, 6, 1);
  geometry.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(segments, 3, 0));
  geometry.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(segments, 3, 3));
  const segmentColors = new THREE.InstancedInterleavedBuffer(colors, 6, 1);
  geometry.setAttribute('instanceColorStart', new THREE.InterleavedBufferAttribute(segmentColors, 3, 0));
  geometry.setAttribute('instanceColorEnd', new THREE.InterleavedBufferAttribute(segmentColors, 3, 3));
  geometry.setAttribute('instanceWidth', new THREE.InstancedBufferAttribute(widths, 1));
  geometry.instanceCount = positions.length / 6;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  return geometry;
}

/** One float texture over a shared float array; `floatsPerTexel` is 3 (RGB) or 1 (red). */
interface TextureRun {
  texture: THREE.DataTexture;
  layout: RibbonTextureLayout;
  /** set when the texture is a dense copy of the array instead of a view into it */
  mirror?: { source: Float32Array; texels: number; floatsPerTexel: number };
}

/**
 * A texture over `texels` texels of `array`. A run of whole interleaved buffers is already a dense
 * float sequence (segment start and end are neighbouring texels), so the texture reads the shared
 * buffer in place. Only a layout with free texels in its last row needs a copy: the texels are padded
 * with zeros, costing `width * height * floatsPerTexel * 4` bytes and nothing per segment.
 */
export function textureRun(
  array: Float32Array,
  floatsPerTexel: number,
  texels: number,
  layout: RibbonTextureLayout,
  format: THREE.PixelFormat,
  internalFormat: THREE.PixelFormatGPU,
): TextureRun {
  const dense = !layout.padded && array.length === texels * floatsPerTexel;
  const data = dense ? array : new Float32Array(layout.width * layout.height * floatsPerTexel);
  if (!dense) data.set(array.subarray(0, texels * floatsPerTexel));
  const texture = new THREE.DataTexture(data as Float32Array<ArrayBuffer>, layout.width, layout.height);
  texture.format = format;
  texture.type = THREE.FloatType;
  texture.internalFormat = internalFormat;
  texture.needsUpdate = true;
  return { texture, layout, mirror: dense ? undefined : { source: array, texels, floatsPerTexel } };
}

/** Bring a padded copy up to date after the shared array changed in place. */
export function refreshTextureRun(run: TextureRun): void {
  const mirror = run.mirror;
  if (!mirror) return;
  const data = run.texture.image.data as unknown as Float32Array;
  const { floatsPerTexel, texels } = mirror;
  for (let i = 0; i < texels * floatsPerTexel; i++) data[i] = mirror.source[i];
}

/**
 * The screen-space extrusion ribbon: world width, but never narrower than the pixel floor. The
 * segments live in float textures so a window of the shared buffers can start at any segment; the
 * interleaved buffer stores the start and the end of a segment as two neighbouring texels, which is
 * why one texture per buffer serves both. A texture row is never wider than the device allows, and
 * the shader wraps the segment index across the rows.
 */
export class ToolpathMaterial extends THREE.ShaderMaterial {
  private readonly positionRun: TextureRun;
  private readonly colorRun: TextureRun;
  private readonly widthRun: TextureRun;

  constructor(geometry: THREE.InstancedBufferGeometry, maxTextureSize: number) {
    const starts = geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
    const colorStarts = geometry.getAttribute('instanceColorStart') as THREE.InterleavedBufferAttribute;
    const widths = geometry.getAttribute('instanceWidth') as THREE.BufferAttribute;
    const count = starts.data.count;
    const segmentLayout = wrapTextureLayout(count * 2, maxTextureSize);
    const widthLayout = wrapTextureLayout(count, maxTextureSize);
    if (!segmentLayout || !widthLayout) throw new Error(`toolpath ribbons do not fit a ${maxTextureSize}-texel texture`);
    super({
      uniforms: {
        linewidth: { value: FALLBACK_EXTRUSION_WIDTH },
        opacity: { value: 1 },
        resolution: { value: 1 },
        fovScale: { value: 0.001 },
        uFirst: { value: 0 },
        instanceStartTex: { value: null },
        instanceColorStartTex: { value: null },
        instanceWidthTex: { value: null },
      },
      vertexShader: `
        uniform float fovScale;
        uniform float uFirst;
        uniform sampler2D instanceStartTex;
        uniform sampler2D instanceColorStartTex;
        uniform sampler2D instanceWidthTex;
        varying vec3 vColor;
        /** The texel of one end of a segment: its start sits at index 2i, its end at 2i + 1. */
        ivec2 endOf(sampler2D run, int segment, int end) {
          ivec2 size = textureSize(run, 0);
          int index = segment * 2 + end;
          return ivec2(index % size.x, index / size.x);
        }
        void main() {
          // WebGL starts every instance at attribute zero: move the shared buffers' window here.
          int segment = gl_InstanceID + int(uFirst);
          #ifdef USE_COLOR
            vec3 colourStart = texelFetch(instanceColorStartTex, endOf(instanceColorStartTex, segment, 0), 0).rgb;
            vec3 colourEnd = texelFetch(instanceColorStartTex, endOf(instanceColorStartTex, segment, 1), 0).rgb;
            vColor = position.x < 0.0 ? colourStart : colourEnd;
          #endif
          vec3 segmentStart = texelFetch(instanceStartTex, endOf(instanceStartTex, segment, 0), 0).xyz;
          vec3 segmentEnd = texelFetch(instanceStartTex, endOf(instanceStartTex, segment, 1), 0).xyz;
          ivec2 widthSize = textureSize(instanceWidthTex, 0);
          float width = texelFetch(instanceWidthTex, ivec2(segment % widthSize.x, segment / widthSize.x), 0).x;
          vec4 start = modelViewMatrix * vec4(segmentStart, 1.0);
          vec4 end = modelViewMatrix * vec4(segmentEnd, 1.0);
          vec3 direction = end.xyz - start.xyz;
          float lengthMm = length(direction);
          vec3 along = lengthMm > 0.000001 ? direction / lengthMm : vec3(1.0, 0.0, 0.0);
          vec3 centre = (start.xyz + end.xyz) * 0.5;
          vec3 toCamera = normalize(-centre);
          vec3 side = cross(along, toCamera);
          float sideLength = length(side);
          // An extrusion pointing straight at the camera has no stable ribbon direction; an arbitrary
          // perpendicular keeps its cap visible instead of producing a degenerate triangle.
          if (sideLength < 0.000001) {
            side = cross(along, abs(along.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0));
            sideLength = length(side);
          }
          side /= max(sideLength, 0.000001);
          vec4 clipCentre = projectionMatrix * vec4(centre, 1.0);
          float mmPerPixel = 2.0 * abs(clipCentre.w) * fovScale;
          float halfWidth = max(width, ${MIN_TOOLPATH_PIXELS} * mmPerPixel) * 0.5;
          vec3 offset = along * (position.y * (lengthMm * 0.5 + halfWidth)) + side * (position.x * halfWidth);
          gl_Position = projectionMatrix * vec4(centre + offset, 1.0);
        }
      `,
      fragmentShader: `
        uniform float opacity;
        varying vec3 vColor;
        void main() {
          gl_FragColor = vec4(vColor, opacity);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.positionRun = textureRun(starts.data.array as Float32Array, 3, count * 2, segmentLayout, THREE.RGBFormat, 'RGB32F');
    this.colorRun = textureRun(colorStarts.data.array as Float32Array, 3, count * 2, segmentLayout, THREE.RGBFormat, 'RGB32F');
    this.widthRun = textureRun(widths.array as Float32Array, 1, count, widthLayout, THREE.RedFormat, 'R32F');
    this.uniforms.instanceStartTex.value = this.positionRun.texture;
    this.uniforms.instanceColorStartTex.value = this.colorRun.texture;
    this.uniforms.instanceWidthTex.value = this.widthRun.texture;
    this.vertexColors = true;
  }

  /** Dispose only the texture views; the mesh disposer owns the shared attribute buffers. */
  override dispose(): void {
    this.positionRun.texture.dispose();
    this.colorRun.texture.dispose();
    this.widthRun.texture.dispose();
    super.dispose();
  }

  /** Mark the texture views after an in-place feature-mask or colour update; views need no refresh. */
  refresh(kind: 'position' | 'color'): void {
    const run = kind === 'position' ? this.positionRun : this.colorRun;
    refreshTextureRun(run);
    run.texture.needsUpdate = true;
  }

  /** The layout of the segment textures, for the unit test and the E2E probe. */
  get segmentLayout(): RibbonTextureLayout {
    return this.positionRun.layout;
  }

  /** Tangent of half the vertical field of view; zero selects an orthographic projection. */
  setFovScale(scale: number): void {
    this.uniforms.fovScale.value = Math.max(0, scale);
  }
}
