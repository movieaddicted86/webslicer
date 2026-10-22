/**
 * B1: clearing a scene group must release what it held. `THREE.Group.clear()` only drops the
 * children, so the bed and the G-code preview kept every rebuild's geometries, materials and
 * textures on the GPU (`renderer.info.memory` never went back down).
 *
 * The test counts dispose events the way the renderer does – it listens to `dispose` on each
 * geometry, material and texture, and fails if one is still alive after `clearAndDispose`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clearAndDispose, disposeRemovedGeometries, disposeSubtree } from './dispose';

function watch<T extends { addEventListener: (t: 'dispose', f: () => void) => void }>(resource: T): { disposed: () => boolean } {
  let disposed = false;
  resource.addEventListener('dispose', () => {
    disposed = true;
  });
  return { disposed: () => disposed };
}

function bedLikeGroup(): { group: THREE.Group; resources: Array<{ disposed: () => boolean }> } {
  const group = new THREE.Group();
  const geometry = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(10, 0)]));
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(geometry, material);
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 0)]),
    new THREE.LineBasicMaterial(),
  );
  group.add(mesh, lines);
  return {
    group,
    resources: [watch(geometry), watch(material), watch(texture), watch(lines.geometry), watch(lines.material as THREE.Material)],
  };
}

test('clearAndDispose releases geometries, materials and textures and empties the group', () => {
  const { group, resources } = bedLikeGroup();
  clearAndDispose(group);
  assert.equal(group.children.length, 0, 'the group is empty');
  for (const [i, r] of resources.entries()) assert.ok(r.disposed(), `resource ${i} was disposed`);
});

test('clearAndDispose handles a material array', () => {
  const group = new THREE.Group();
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
  const watches = materials.map((m) => watch(m));
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), materials));
  clearAndDispose(group);
  for (const w of watches) assert.ok(w.disposed());
});

test('disposeSubtree disposes nested groups (the vendor bed model is one level below)', () => {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const w = watch(geometry);
  inner.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
  root.add(inner);
  disposeSubtree(root);
  assert.ok(w.disposed());
  assert.equal(root.children.length, 1, 'disposeSubtree does not change the structure');
});

/** A plater instance node as far as the disposal sees it: the body mesh and its volume meshes. */
function instanceNode(geometry: THREE.BufferGeometry, volumeGeometries: THREE.BufferGeometry[] = []) {
  return {
    mesh: new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()),
    volumes: new Map(volumeGeometries.map((g, i) => [`vol-${i}`, new THREE.Mesh(g, new THREE.MeshBasicMaterial())])),
  };
}

test('disposeRemovedGeometries releases the body and volume geometries of a removed object', () => {
  const body = new THREE.BoxGeometry();
  const volume = new THREE.ConeGeometry(1, 2, 8);
  const watches = [watch(body), watch(volume)];
  // nothing is left on the plater, so `live` is empty
  disposeRemovedGeometries([instanceNode(body, [volume])], new Set());
  for (const w of watches) assert.ok(w.disposed());
});

test('disposeRemovedGeometries keeps a geometry another object still shares', () => {
  const shared = new THREE.BoxGeometry();
  const sharedWatch = watch(shared);
  const own = new THREE.ConeGeometry(1, 2, 8);
  const ownWatch = watch(own);
  disposeRemovedGeometries([instanceNode(shared), instanceNode(own)], new Set([shared]));
  assert.equal(sharedWatch.disposed(), false, 'a duplicate still draws this geometry');
  assert.ok(ownWatch.disposed());
});

test('disposeRemovedGeometries disposes a geometry shared by two removed instances only once', () => {
  const shared = new THREE.BoxGeometry();
  let disposes = 0;
  shared.addEventListener('dispose', () => disposes++);
  disposeRemovedGeometries([instanceNode(shared), instanceNode(shared)], new Set());
  assert.equal(disposes, 1);
});
