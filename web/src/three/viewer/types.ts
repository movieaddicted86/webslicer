/**
 * The shapes the viewer's hooks pass between each other (R-7). `SceneRefs` is the one mutable
 * object every hook reaches through: the init effect fills it, the others read it and bail out
 * while it is still `null` (the first render, and after the StrictMode teardown).
 */
import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { MarkerKind, ParsedGcode } from '../../gcode/types';
import type { CameraView } from '../../plater/camera';

export interface InstanceNode {
  /** scene node carrying the instance transform; its children are in object-local coordinates */
  group: THREE.Group;
  /** object body; shares the geometry with its sibling instances, owns its material (per-instance colour) */
  mesh: THREE.Mesh;
  volumes: Map<string, THREE.Mesh>;
  /** translucent slabs visualizing height range modifiers */
  slabs?: THREE.Group;
  slabKey?: string;
}

interface ObjectNode {
  /** pure container, no transform of its own */
  group: THREE.Group;
  /** one scene node per instance */
  instances: Map<string, InstanceNode>;
}

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** the active camera – `persp` or `ortho`; controls, picking and rendering all use it */
  camera: THREE.Camera;
  persp: THREE.PerspectiveCamera;
  ortho: THREE.OrthographicCamera;
  controls: OrbitControls;
  transform: TransformControls;
  bedGroup: THREE.Group;
  objectsGroup: THREE.Group;
  gcodeGroup: THREE.Group;
  nodes: Map<string, ObjectNode>;
  raycaster: THREE.Raycaster;
  dragging: boolean;
  gcodeLines?: THREE.LineSegments;
  travelLines?: THREE.LineSegments;
  wipeLines?: THREE.LineSegments;
  /** one THREE.Points per marker kind, so each kind can be toggled and coloured on its own */
  markerPoints?: Map<MarkerKind, THREE.Points>;
  /** cone following the horizontal slider */
  toolMarker?: THREE.Mesh;
  gcodeRef?: ParsedGcode;
  /** key of the colouring currently applied to the toolpaths */
  colorKey?: string;
  bedKey?: string;
  /** meshes of the plater, drawn translucent while "Shells" is on */
  shells: { mesh: THREE.Mesh; key: string }[];
  shellsOn: boolean;
}

export interface BedAsset {
  vendor: string;
  model?: string;
  texture?: string;
}

/** A camera command from a toolbar button or a key; the sequence number makes a repeat re-run. */
export type CamRequest = { mode: 'view'; view: CameraView } | { mode: 'fit' } | { mode: 'bed' };
