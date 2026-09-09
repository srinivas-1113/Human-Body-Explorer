import * as THREE from 'three';
import { createMeshStructure } from './anatomyStructureFactory';
import type { AnatomySystem } from './types';

export type LoadedAnatomyModel = {
  group: THREE.Group;
  sourceText: string;
  structures: THREE.Mesh[];
  structureCount: number;
  systemCounts: Map<AnatomySystem, number>;
};

export type LoadAnatomyModelOptions = {
  dracoDecoderPath: string;
  floorY: number;
  targetHeight: number;
};

type AnatomyModelRegistry = {
  structures: THREE.Mesh[];
  systemCounts: Map<AnatomySystem, number>;
  usedIds: Map<string, number>;
};

type RegisterAnatomyMeshOptions = {
  castShadow: boolean;
  context?: string;
  fallbackName: string;
  receiveShadow: boolean;
  regionHint: string;
  source: string;
  sourceKey: string;
};

function cloneMaterial(material: THREE.Material | THREE.Material[]) {
  const cloneOne = (item: THREE.Material) => {
    const cloned = item.clone();
    cloned.side = THREE.DoubleSide;
    return cloned;
  };
  return Array.isArray(material) ? material.map(cloneOne) : cloneOne(material);
}

export function fitGroupToBody(group: THREE.Group, targetHeight: number, floorY: number) {
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (size.y <= 0) return;
  const scale = targetHeight / size.y;
  group.scale.setScalar(scale);
  group.position.set(-center.x * scale, floorY - box.min.y * scale, -center.z * scale);
}

export function registerAnatomyMesh(
  mesh: THREE.Mesh,
  registry: AnatomyModelRegistry,
  options: RegisterAnatomyMeshOptions
) {
  mesh.material = cloneMaterial(mesh.material as THREE.Material | THREE.Material[]);
  mesh.castShadow = options.castShadow;
  mesh.receiveShadow = options.receiveShadow;

  const baseName = (mesh.name || options.fallbackName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'structure';
  const baseId = `${options.sourceKey}:${baseName}`;
  const occurrence = (registry.usedIds.get(baseId) ?? 0) + 1;
  registry.usedIds.set(baseId, occurrence);
  const stableId = occurrence === 1 ? baseId : `${baseId}:${occurrence}`;

  const structure = createMeshStructure(mesh, {
    context: options.context,
    fallbackName: options.fallbackName,
    id: stableId,
    regionHint: options.regionHint,
    source: options.source
  });

  mesh.userData.system = structure.system;
  mesh.userData.part = structure;
  mesh.userData.source = options.sourceKey;
  registry.systemCounts.set(structure.system, (registry.systemCounts.get(structure.system) ?? 0) + 1);
  registry.structures.push(mesh);
}
