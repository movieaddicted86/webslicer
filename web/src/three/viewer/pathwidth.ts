/** Width of the preview's extrusion ribbons, derived from the G-code rather than a fixed line size. */
import * as THREE from 'three';

/** PrusaSlicer's common nozzle/extrusion width, used when a G-code has no usable `;WIDTH:` comment. */
export const FALLBACK_EXTRUSION_WIDTH = 0.45;
/** Even a thin extrusion stays recognisable when the camera is far away. */
export const MIN_TOOLPATH_PIXELS = 1.5;
/** Below this real path width, hairlines keep dense far-away views cheap. */
export const RIBBON_PIXEL_THRESHOLD = 3;

/** Opt-in E2E baseline: `?testToolpaths=hairlines`; normal visits always use the adaptive renderer. */
export function toolpathMode(search: string): 'adaptive' | 'hairlines' {
  return new URLSearchParams(search).get('testToolpaths') === 'hairlines' ? 'hairlines' : 'adaptive';
}

/** The millimetres an extrusion ribbon spans; missing or invalid widths get the common fallback. */
export function extrusionWidth(width: number | undefined): number {
  return width !== undefined && Number.isFinite(width) && width > 0 ? width : FALLBACK_EXTRUSION_WIDTH;
}

/** World height at the look-at target; orthographic and perspective views agree through their framing. */
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

/** The screen-space extrusion ribbon: world width, but never narrower than the pixel floor. */
export class ToolpathMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        linewidth: { value: FALLBACK_EXTRUSION_WIDTH },
        opacity: { value: 1 },
        resolution: { value: 1 },
        fovScale: { value: 0.001 },
      },
      vertexShader: `
        attribute vec3 instanceStart;
        attribute vec3 instanceEnd;
        attribute vec3 instanceColorStart;
        attribute vec3 instanceColorEnd;
        attribute float instanceWidth;
        uniform float fovScale;
        varying vec3 vColor;
        void main() {
          #ifdef USE_COLOR
            vColor = position.x < 0.0 ? instanceColorStart : instanceColorEnd;
          #endif
          vec4 start = modelViewMatrix * vec4(instanceStart, 1.0);
          vec4 end = modelViewMatrix * vec4(instanceEnd, 1.0);
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
          float halfWidth = max(instanceWidth, ${MIN_TOOLPATH_PIXELS} * mmPerPixel) * 0.5;
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
    this.uniforms.fovScale.value = 0.001;
    this.uniforms.linewidth.value = FALLBACK_EXTRUSION_WIDTH;
    this.vertexColors = true;
  }

  /** Tangent of half the vertical field of view; zero selects an orthographic projection. */
  setFovScale(scale: number): void {
    this.uniforms.fovScale.value = Math.max(0, scale);
  }
}
