import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadAnatomyAtlas } from './atlasSource';
import type { LoadedAnatomyModel } from './anatomyModel';
import { createStructureVisibility } from './structureVisibility';
import { systemLabel } from './structureMetadata';
import type { AnatomyStructure, AnatomySystem, AnatomySystemOption, AnatomyVisibilityStructure } from './types';
import { logViewerError, logViewerEvent } from '../telemetry';
import {
  hideSearchResults,
  isDetailsPanelCollapsed,
  isSystemsPanelCollapsed,
  mountAnatomyShell,
  renderBrowser,
  renderRegions,
  renderSearchResults,
  renderSystemFilters,
  setDetailsPanelCollapsed,
  setSystemsPanelCollapsed,
  setSystemTab,
  showEmptySelection,
  showSelectedStructure,
  updateSourceStatus,
  updateStructureActions,
  updateVisibleStructureCount
} from './ui';

const FLOOR_Y = -2.26;
const TARGET_BODY_HEIGHT = 6.75;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 3.0, 8.8);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 1.45, 0);
const FOCUS_PADDING = 1.35;
const SELECTED_ZOOM_MIN_DISTANCE = 0.08;
const SELECTED_ZOOM_MAX_DISTANCE = 8.5;

export type AnatomyViewer = { dispose: () => void };

type MaterialState = { color?: THREE.Color; opacity: number; transparent: boolean; depthWrite: boolean };

function materialList(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function materialColor(material: THREE.Material) {
  const maybeColor = material as THREE.Material & { color?: THREE.Color };
  return maybeColor.color;
}

export function createAnatomyViewer(root: HTMLDivElement): AnatomyViewer {
  const shell = mountAnatomyShell(root);
  const renderer = new THREE.WebGLRenderer({ canvas: shell.canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f7f8);
  scene.fog = new THREE.Fog(0xf5f7f8, 14, 28);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.03, 80);
  camera.position.copy(DEFAULT_CAMERA_POSITION);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.target.copy(DEFAULT_CAMERA_TARGET);
  controls.cursor.copy(DEFAULT_CAMERA_TARGET);
  controls.minDistance = SELECTED_ZOOM_MIN_DISTANCE;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.94;
  controls.minPolarAngle = Math.PI * 0.06;
  controls.panSpeed = 0.85;
  controls.zoomSpeed = 0.85;
  // For anatomy study, zooming should follow the selected structure rather than
  // the mouse cursor. This makes click -> scroll/pinch behave like a true
  // structure-level zoom instead of a generic canvas zoom.
  controls.zoomToCursor = false;

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc7d0d5, 2.15));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.7);
  keyLight.position.set(4, 8, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x8fddea, 0.55);
  rimLight.position.set(-5, 4, -4);
  scene.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.8, 80),
    new THREE.MeshStandardMaterial({ color: 0xe9edef, roughness: 0.94, metalness: 0.01 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR_Y - 0.1;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(9, 18, 0xd7dee1, 0xe3e8ea);
  grid.position.y = FLOOR_Y - 0.08;
  grid.material.opacity = 0.45;
  grid.material.transparent = true;
  scene.add(grid);

  const body = new THREE.Group();
  scene.add(body);
  let anatomyMeshes: THREE.Mesh[] = [];
  let structures: AnatomyStructure[] = [];
  let availableSystems: AnatomySystemOption[] = [];
  let systemTab: 'all' | 'systems' | 'organs' = 'all';
  let hovered: THREE.Mesh | null = null;
  let selected: THREE.Mesh | null = null;
  let isolated = false;
  let contextMode = false;
  let activeRegion = 'all';
  let animationFrame = 0;
  let lastHoverPickAt = 0;
  let pointerDownPosition = new THREE.Vector2();
  let cameraAnimation: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; started: number; duration: number } | null = null;
  let explodeAmount = 0;
  let explodedCameraFramed = false;
  let explodeScroll = 0;
  let explodeMaxScroll = 0;
  const explodeOrigins = new WeakMap<THREE.Mesh, { worldPosition: THREE.Vector3; direction: THREE.Vector3 }>();
  const explodeTargets = new WeakMap<THREE.Mesh, THREE.Vector3>();

  const visibility = createStructureVisibility();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const baseColors = new WeakMap<THREE.Material, THREE.Color>();
  const materialStates = new WeakMap<THREE.Material, MaterialState>();
  const compactPanelsQuery = window.matchMedia('(max-width: 760px)');
  const structureById = new Map<string, THREE.Mesh>();

  function rememberMaterial(material: THREE.Material) {
    if (materialStates.has(material)) return;
    materialStates.set(material, {
      color: materialColor(material)?.clone(),
      opacity: material.opacity,
      transparent: material.transparent,
      depthWrite: material.depthWrite
    });
  }

  function restoreMaterial(material: THREE.Material) {
    const state = materialStates.get(material);
    if (!state) return;
    const color = materialColor(material);
    if (color && state.color) color.copy(state.color);
    material.opacity = state.opacity;
    material.transparent = state.transparent;
    material.depthWrite = state.depthWrite;
    material.needsUpdate = true;
  }

  function setEmphasis(mesh: THREE.Mesh | null, active: boolean) {
    if (!mesh) return;
    for (const material of materialList(mesh.material as THREE.Material | THREE.Material[])) {
      rememberMaterial(material);
      const color = materialColor(material);
      if (!color) continue;
      if (!baseColors.has(material)) baseColors.set(material, color.clone());
      color.copy(baseColors.get(material)!);
      if (active) color.lerp(new THREE.Color(0x5ee7ff), 0.52);
      material.needsUpdate = true;
    }
  }

  function setContextVisuals() {
    for (const mesh of anatomyMeshes) {
      for (const material of materialList(mesh.material as THREE.Material | THREE.Material[])) {
        rememberMaterial(material);
        const structure = structureForMesh(mesh);
        const isSelected = mesh === selected;
        if (contextMode && selected && structure && !isSelected && mesh.visible) {
          material.transparent = true;
          material.opacity = 0.13;
          material.depthWrite = false;
        } else {
          restoreMaterial(material);
        }
      }
    }
    if (selected) setEmphasis(selected, true);
  }

  function setPointerFromClientPosition(clientX: number, clientY: number) {
    const rect = shell.canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  }

  function intersectVisibleAnatomy() {
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(anatomyMeshes.filter((mesh) => mesh.visible), false)[0];
  }

  function structureForMesh(mesh: THREE.Mesh | null) {
    return mesh?.userData.part as AnatomyStructure | undefined;
  }

  function visibilityStructureForMesh(mesh: THREE.Mesh): AnatomyVisibilityStructure | null {
    const structure = structureForMesh(mesh);
    return structure ? { id: structure.id, system: structure.system } : null;
  }

  function filteredStructures() {
    return structures.filter((structure) => activeRegion === 'all' || structure.region === activeRegion);
  }

  function structuresForCurrentTab() {
    const regionFiltered = filteredStructures();
    if (systemTab === 'organs') return regionFiltered.filter((structure) => structure.system === 'organ');
    if (systemTab === 'systems') return regionFiltered.filter((structure) => structure.system !== 'organ');
    return regionFiltered;
  }

  function systemsForCurrentTab() {
    if (systemTab === 'organs') return availableSystems.filter((option) => option.id === 'organ');
    if (systemTab === 'systems') return availableSystems.filter((option) => option.id !== 'organ');
    return availableSystems;
  }

  function updateSystemFilterList() {
    renderSystemFilters(shell.systemFiltersEl, systemsForCurrentTab(), visibility.enabledSystems, setSystemEnabled);
  }

  function setSystemTabMode(tab: 'all' | 'systems' | 'organs') {
    systemTab = tab;
    setSystemTab(shell, tab);
    updateSystemFilterList();
  }

  function updateBrowser() {
    const filtered = structuresForCurrentTab();
    renderBrowser(shell.browserEl, filtered, selectStructureById);
    const countEl = shell.browserEl.parentElement?.querySelector('#browser-count');
    if (countEl) countEl.textContent = `${filtered.length.toLocaleString()} available`;
  }

  function updateRegions() {
    const regions = [...new Set(structures.map((structure) => structure.region))].sort((a, b) => a.localeCompare(b));
    renderRegions(shell.regionSelect, regions, activeRegion);
  }

  function updateVisibility() {
    const visibilityStructures = anatomyMeshes.map(visibilityStructureForMesh).filter((item): item is AnatomyVisibilityStructure => !!item);
    const result = visibility.resolve(visibilityStructures);
    const filteredIds = new Set(filteredStructures().map((structure) => structure.id));

    for (const mesh of anatomyMeshes) {
      const structure = structureForMesh(mesh);
      const systemVisible = !!structure && result.visibleStructureIds.has(structure.id);
      const regionVisible = !!structure && filteredIds.has(structure.id);
      const isolateVisible = !isolated || mesh === selected;
      mesh.visible = systemVisible && regionVisible && isolateVisible;
    }

    if (contextMode) setContextVisuals();
    if (explodeAmount > 0 && anatomyMeshes.length) {
      const visibleForExplode = anatomyMeshes.filter((mesh) => mesh.visible);
      // A visibility/filter change is a new catalogue. Re-center the camera
      // on that catalogue instead of preserving the scroll position from the
      // previous set of structures. The user can then scroll from the center
      // through the newly filtered collection.
      explodeScroll = 0;
      rebuildExplodeTargets(visibleForExplode);
      if (explodeMaxScroll > 0.05) {
        explodeScroll = explodeMaxScroll * 0.5;
        shell.explodeScroll.value = String(explodeScroll);
      }
      applyExplode(explodeAmount, false);
      if (explodedCameraFramed) applyExplodedCameraScroll(false);
    }
    updateVisibleStructureCount(shell, anatomyMeshes.filter((mesh) => mesh.visible).length, filteredStructures().length, anatomyMeshes.length);
    if (selected && !selected.visible) {
      setSelection(null);
      isolated = false;
    }
    refreshStructureActions();
  }

  function refreshStructureActions() {
    updateStructureActions(shell, !!selected, visibility.hiddenCount, isolated, contextMode);
  }

  function setSelection(mesh: THREE.Mesh | null, focus = false) {
    if (selected && selected !== hovered) setEmphasis(selected, false);
    selected = mesh;
    if (selected) setEmphasis(selected, true);
    const structure = structureForMesh(selected);
    if (!structure) {
      showEmptySelection(shell, compactPanelsQuery.matches);
      refreshStructureActions();
      setContextVisuals();
      return;
    }
    // Keep the inspector open for every selected mesh, including parts
    // selected directly from the exploded catalogue.
    showSelectedStructure(shell, structure, compactPanelsQuery.matches);
    setDetailsPanelCollapsed(shell, false);
    refreshStructureActions();
    setContextVisuals();
    logViewerEvent('Structure Selected', { name: structure.name, region: structure.region, source: structure.source, system: structure.system });
    if (focus) focusStructure(selected);
  }

  function pick(event: PointerEvent, commit: boolean) {
    const now = performance.now();
    if (!commit && now - lastHoverPickAt < 45) return;
    lastHoverPickAt = now;
    setPointerFromClientPosition(event.clientX, event.clientY);
    const hit = intersectVisibleAnatomy();
    const hitMesh = hit?.object as THREE.Mesh | undefined;
    if (hovered && hovered !== selected) setEmphasis(hovered, false);
    hovered = hitMesh ?? null;
    if (hovered) setEmphasis(hovered, true);
    shell.canvas.style.cursor = hovered ? 'pointer' : 'grab';
    if (commit && hovered) {
      // Selection in exploded mode must never implicitly focus, zoom, pan,
      // resize, or reposition the chosen mesh. The catalogue position is
      // authoritative until the user explicitly presses Focus.
      const wasExploded = explodeAmount >= 1;
      const cameraPosition = wasExploded ? camera.position.clone() : null;
      const cameraTarget = wasExploded ? controls.target.clone() : null;
      const meshPosition = wasExploded ? hovered.position.clone() : null;
      const meshQuaternion = wasExploded ? hovered.quaternion.clone() : null;
      const meshScale = wasExploded ? hovered.scale.clone() : null;

      setSelection(hovered);

      if (wasExploded && cameraPosition && cameraTarget && meshPosition && meshQuaternion && meshScale) {
        camera.position.copy(cameraPosition);
        controls.target.copy(cameraTarget);
        controls.cursor.copy(cameraTarget);
        hovered.position.copy(meshPosition);
        hovered.quaternion.copy(meshQuaternion);
        hovered.scale.copy(meshScale);
      }
    }
  }

  function resize() {
    const rect = shell.canvas.parentElement?.getBoundingClientRect();
    const width = Math.max(1, rect?.width ?? window.innerWidth);
    const height = Math.max(1, rect?.height ?? window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (explodeAmount > 0) {
      updateExplodedScrollRange();
      if (explodedCameraFramed) applyExplodedCameraScroll(false);
    }
  }

  function animateCamera(toPosition: THREE.Vector3, toTarget: THREE.Vector3, duration = 650) {
    cameraAnimation = {
      fromPos: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPos: toPosition.clone(),
      toTarget: toTarget.clone(),
      started: performance.now(),
      duration
    };
  }

  function updateCameraAnimation(now: number) {
    if (!cameraAnimation) return;
    const progress = Math.min(1, (now - cameraAnimation.started) / cameraAnimation.duration);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    camera.position.lerpVectors(cameraAnimation.fromPos, cameraAnimation.toPos, eased);
    controls.target.lerpVectors(cameraAnimation.fromTarget, cameraAnimation.toTarget, eased);
    controls.cursor.copy(controls.target);
    if (progress >= 1) cameraAnimation = null;
  }

  function structureZoomDistance(mesh: THREE.Mesh) {
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return 1.2;
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;
    // Fit the selected structure to the viewport using the camera FOV instead
    // of a fixed distance. Small organs/parts can therefore be inspected
    // independently of the full-body model.
    const fovRadians = THREE.MathUtils.degToRad(camera.fov);
    const fitDistance = radius / Math.tan(fovRadians * 0.5) * FOCUS_PADDING;
    return THREE.MathUtils.clamp(fitDistance, 0.12, SELECTED_ZOOM_MAX_DISTANCE);
  }

  function selectedStructureCenter(mesh: THREE.Mesh | null) {
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return null;
    return box.getCenter(new THREE.Vector3());
  }

  function focusStructure(mesh: THREE.Mesh | null) {
    if (!mesh) return;
    const center = selectedStructureCenter(mesh);
    if (!center) return;
    const distance = structureZoomDistance(mesh);
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() < 0.1) direction.set(0, 0.2, 1).normalize();
    animateCamera(center.clone().add(direction.multiplyScalar(distance)), center, 620);
    logViewerEvent('Structure Focused', { name: structureForMesh(mesh)?.name ?? 'unknown' });
  }

  function captureExplodeOrigins() {
    if (!anatomyMeshes.length) return;
    body.updateMatrixWorld(true);
    const bodyBox = new THREE.Box3().setFromObject(body);
    const bodyCenter = bodyBox.getCenter(new THREE.Vector3());

    // Origins are captured once from the assembled anatomical model. They are
    // deliberately independent from visibility filters so changing systems,
    // regions, or hidden parts never corrupts the assembled positions.
    for (const mesh of anatomyMeshes) {
      const worldPosition = mesh.getWorldPosition(new THREE.Vector3());
      const meshBox = new THREE.Box3().setFromObject(mesh);
      const meshCenter = meshBox.isEmpty() ? worldPosition.clone() : meshBox.getCenter(new THREE.Vector3());
      const direction = meshCenter.sub(bodyCenter);
      if (direction.lengthSq() < 0.000001) direction.set(0, 0.15, 1);
      direction.normalize();
      explodeOrigins.set(mesh, { worldPosition, direction });
    }

    rebuildExplodeTargets(anatomyMeshes);
  }

  function rebuildExplodeTargets(layoutMeshes: THREE.Mesh[]) {
    if (!layoutMeshes.length) return;

    // The exploded view is a bounded, centered catalogue.  Positions are
    // calculated from ONLY the structures currently visible after system,
    // region, and hide filters are applied.  This is deliberately independent
    // of the original body coordinates: a filtered set must always re-center
    // itself instead of inheriting the full 1,767-part layout.
    const systemOrder: AnatomySystem[] = [
      'bone', 'muscle', 'connective', 'vascular', 'nervous', 'organ',
      'digestive', 'respiratory', 'urinary', 'reproductive', 'lymphatic', 'other'
    ];
    const grouped = new Map<AnatomySystem, THREE.Mesh[]>();
    for (const system of systemOrder) grouped.set(system, []);
    for (const mesh of layoutMeshes) {
      const structure = structureForMesh(mesh);
      const system = structure?.system ?? 'other';
      if (!grouped.has(system)) grouped.set(system, []);
      grouped.get(system)!.push(mesh);
    }

    const count = layoutMeshes.length;
    // Keep the catalogue comfortably inside the camera width.  Fewer items
    // use fewer columns, so a filtered selection remains centered and readable.
    const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : count <= 20 ? 4 : count <= 60 ? 6 : count <= 180 ? 8 : 12;
    const cellX = count <= 20 ? 1.35 : count <= 60 ? 1.15 : count <= 180 ? 1.0 : 0.9;
    const cellY = count <= 20 ? 1.05 : count <= 60 ? 0.9 : count <= 180 ? 0.78 : 0.68;
    const bandGap = count <= 60 ? 0.55 : 0.38;
    const layoutWidth = Math.max(cellX, (columns - 1) * cellX);

    const preparedBands: Array<{ system: AnatomySystem; meshes: THREE.Mesh[]; rows: number }> = [];
    let totalRows = 0;
    for (const system of systemOrder) {
      const meshes = grouped.get(system) ?? [];
      meshes.sort((a, b) => {
        const sa = structureForMesh(a);
        const sb = structureForMesh(b);
        return (sa?.region ?? '').localeCompare(sb?.region ?? '') ||
          (sa?.name ?? a.name).localeCompare(sb?.name ?? b.name);
      });
      if (!meshes.length) continue;
      const rows = Math.ceil(meshes.length / columns);
      preparedBands.push({ system, meshes, rows });
      totalRows += rows;
    }

    const bandCount = preparedBands.length;
    const gapRows = Math.max(0, bandCount - 1);
    totalRows += gapRows;

    // Always center the catalogue around the normal anatomy target.  This is
    // the key difference from the old implementation, which centered using
    // the body's world-space bounds and could push a filtered set off-center.
    const centerY = DEFAULT_CAMERA_TARGET.y;
    const totalHeight = Math.max(cellY, totalRows * cellY + bandGap * gapRows);
    const topY = centerY + totalHeight * 0.5 - cellY * 0.5;
    let rowCursor = 0;

    for (const band of preparedBands) {
      for (let index = 0; index < band.meshes.length; index += 1) {
        const mesh = band.meshes[index];
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = -layoutWidth * 0.5 + col * cellX;
        const y = topY - (rowCursor + row) * cellY;
        // A tiny depth offset prevents coplanar z-fighting without turning
        // the catalogue into a radial explosion.
        const z = ((index % 3) - 1) * 0.025;
        explodeTargets.set(mesh, new THREE.Vector3(x, y, z));
      }
      rowCursor += band.rows;
      if (band !== preparedBands[preparedBands.length - 1]) {
        rowCursor += Math.max(0.5, bandGap / cellY);
      }
    }

    body.userData.explodeLayout = {
      center: new THREE.Vector3(0, centerY, 0),
      width: Math.max(3.5, layoutWidth + cellX),
      height: totalHeight + cellY
    };
    if (explodeAmount > 0) updateExplodedScrollRange();
  }

  function updateExplodedScrollRange() {
    const layout = body.userData.explodeLayout as { center: THREE.Vector3; width: number; height: number } | undefined;
    if (!layout || explodeAmount < 1) {
      explodeMaxScroll = 0;
      explodeScroll = 0;
      shell.explodeScroll.max = '0';
      shell.explodeScroll.value = '0';
      shell.explodeScrollWrap.classList.remove('visible');
      return;
    }

    const rect = shell.canvas.getBoundingClientRect();
    const aspect = Math.max(0.75, rect.width / Math.max(1, rect.height));
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);

    // Choose a stable camera distance from catalogue width.  The 3D catalogue
    // itself stays centered; scrolling changes only the vertical camera window.
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov * 0.5) * aspect);
    const widthDistance = (layout.width * 0.58) / Math.tan(horizontalFov * 0.5);
    const distance = THREE.MathUtils.clamp(widthDistance, 7.5, 15.5);
    const visibleHeight = 2 * distance * Math.tan(verticalFov * 0.5);

    explodeMaxScroll = Math.max(0, layout.height - visibleHeight * 0.84);
    explodeScroll = THREE.MathUtils.clamp(explodeScroll, 0, explodeMaxScroll);
    shell.explodeScroll.max = String(explodeMaxScroll);
    shell.explodeScroll.value = String(explodeScroll);
    shell.explodeScrollWrap.classList.toggle('visible', explodeMaxScroll > 0.05);
    body.userData.explodeCameraDistance = distance;
  }

  function applyExplodedCameraScroll(animate = false) {
    const layout = body.userData.explodeLayout as { center: THREE.Vector3; width: number; height: number } | undefined;
    if (!layout || explodeAmount < 1) return;

    const distance = Number(body.userData.explodeCameraDistance) || 10;
    // Scroll from the top of the catalogue to the bottom.  With no overflow,
    // the camera stays exactly on the centered catalogue.
    const targetY = layout.center.y + (explodeMaxScroll * 0.5) - explodeScroll;
    const target = new THREE.Vector3(layout.center.x, targetY, layout.center.z);
    const position = target.clone().add(new THREE.Vector3(0, 0, distance));

    if (animate) animateCamera(position, target, 180);
    else {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.cursor.copy(target);
    }
  }

  function applyExplodeTransitionCamera(t: number) {
    const layout = body.userData.explodeLayout as { center: THREE.Vector3; width: number; height: number } | undefined;
    if (!layout) return;

    // During the slider transition the camera follows the same centered
    // exploded catalogue that will be used at 100%.  This prevents the meshes
    // from flying outside the viewport while their positions interpolate from
    // the assembled body into the catalogue.  The camera target and distance
    // are interpolated smoothly rather than jumping at an arbitrary slider
    // threshold.
    const normalTarget = DEFAULT_CAMERA_TARGET.clone();
    const explodedScroll = explodeMaxScroll * t;
    const explodedTarget = new THREE.Vector3(
      layout.center.x,
      layout.center.y + explodeMaxScroll * 0.5 - explodedScroll,
      layout.center.z
    );
    const finalDistance = Number(body.userData.explodeCameraDistance) || 10;
    const normalDistance = DEFAULT_CAMERA_POSITION.distanceTo(DEFAULT_CAMERA_TARGET);
    const distance = THREE.MathUtils.lerp(normalDistance, finalDistance, t);
    const target = normalTarget.clone().lerp(explodedTarget, t);
    const direction = DEFAULT_CAMERA_POSITION.clone().sub(DEFAULT_CAMERA_TARGET).normalize();
    camera.position.copy(target.clone().add(direction.multiplyScalar(distance)));
    controls.target.copy(target);
    controls.cursor.copy(target);
    cameraAnimation = null;
  }

  function frameExplodedLayout() {
    const layout = body.userData.explodeLayout as { center: THREE.Vector3; width: number; height: number } | undefined;
    if (!layout) return;
    updateExplodedScrollRange();
    applyExplodedCameraScroll(true);
    explodedCameraFramed = true;
  }

  function applyExplode(value: number, allowFrame = true) {
    explodeAmount = THREE.MathUtils.clamp(value, 0, 100);
    shell.explodeSlider.value = String(explodeAmount);
    shell.explodeValue.textContent = `${Math.round(explodeAmount)}%`;
    if (!anatomyMeshes.length) return;

    // Interpolate from the real assembled positions into the structured
    // catalogue positions. This gives a stable, non-overlapping visual
    // transition instead of shooting every part radially away from the body.
    const t = THREE.MathUtils.smootherstep(explodeAmount / 100, 0, 1);
    for (const mesh of anatomyMeshes) {
      const origin = explodeOrigins.get(mesh);
      const target = explodeTargets.get(mesh);
      if (!origin || !target || !mesh.parent) continue;
      const targetWorld = target.clone();
      const localTarget = mesh.parent.worldToLocal(targetWorld);
      const assembledLocal = mesh.parent.worldToLocal(origin.worldPosition.clone());
      mesh.position.lerpVectors(assembledLocal, localTarget, t);
    }
    body.updateMatrixWorld(true);
    if (explodeAmount > 0) updateExplodedScrollRange();

    // Follow the final catalogue framing throughout the transition. This is
    // what keeps a partial selection centered and prevents structures from
    // temporarily flying off-screen between the assembled body and the
    // exploded catalogue. At 100% the normal scroll controller takes over.
    if (explodeAmount > 0 && explodeAmount < 100 && body.userData.explodeLayout) {
      applyExplodeTransitionCamera(t);
      explodedCameraFramed = false;
    } else if (allowFrame && explodeAmount >= 100 && !explodedCameraFramed) {
      frameExplodedLayout();
    }

    if (explodeAmount < 20 && explodedCameraFramed) {
      animateCamera(DEFAULT_CAMERA_POSITION, DEFAULT_CAMERA_TARGET, 420);
      explodedCameraFramed = false;
    }
  }

  function resetExplode() {
    explodedCameraFramed = false;
    explodeScroll = 0;
    explodeMaxScroll = 0;
    shell.explodeScrollWrap.classList.remove('visible');
    applyExplode(0);
  }

  function resetCamera() {
    isolated = false;
    contextMode = false;
    resetExplode();
    activeRegion = 'all';
    shell.regionSelect.value = 'all';
    visibility.restoreHidden();
    visibility.enableAll(availableSystems);
    animateCamera(DEFAULT_CAMERA_POSITION, DEFAULT_CAMERA_TARGET, 600);
    updateVisibility();
    if (selected) setSelection(null);
    updateBrowser();
    logViewerEvent('Viewer Reset');
  }

  function setView(direction: THREE.Vector3) {
    const target = selected ? new THREE.Box3().setFromObject(selected).getCenter(new THREE.Vector3()) : DEFAULT_CAMERA_TARGET.clone();
    const distance = selected ? 3.2 : 10.8;
    const position = target.clone().add(direction.clone().normalize().multiplyScalar(distance));
    animateCamera(position, target, 520);
  }

  function setSystemEnabled(system: AnatomySystem, enabled: boolean) {
    visibility.setSystemEnabled(system, enabled);
    updateVisibility();
    updateSystemFilterList();
  }

  function setAllSystems(enabled: boolean) {
    visibility.setAllSystems(availableSystems, enabled);
    updateVisibility();
    updateSystemFilterList();
  }

  function hideSelectedStructure() {
    const structure = structureForMesh(selected);
    if (!structure) return;
    visibility.hideStructure({ id: structure.id, system: structure.system });
    if (selected) setEmphasis(selected, false);
    selected = null;
    isolated = false;
    contextMode = false;
    updateVisibility();
    showEmptySelection(shell, false);
    logViewerEvent('Structure Hidden', { name: structure.name });
  }

  function restoreHiddenStructures() {
    visibility.restoreHidden();
    updateVisibility();
  }

  function toggleIsolate() {
    if (!selected) return;
    isolated = !isolated;
    updateVisibility();
    if (isolated) focusStructure(selected);
  }

  function toggleContext() {
    if (!selected) return;
    contextMode = !contextMode;
    setContextVisuals();
    refreshStructureActions();
  }

  function selectStructureById(id: string) {
    const mesh = structureById.get(id);
    if (!mesh) return;
    isolated = false;
    setSelection(mesh, true);
    hideSearchResults(shell);
    shell.searchInput.blur();
  }

  function search(value: string) {
    const query = value.trim().toLowerCase();
    if (!query) {
      hideSearchResults(shell);
      return;
    }
    const results = structures
      .map((structure) => ({ structure, score: scoreSearch(structure, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.structure.name.localeCompare(b.structure.name))
      .slice(0, 24)
      .map((item) => item.structure);
    renderSearchResults(shell.searchResults, results, selectStructureById);
  }

  function applyLoadedModel(model: LoadedAnatomyModel) {
    anatomyMeshes = model.structures;
    structures = anatomyMeshes.map((mesh) => mesh.userData.part as AnatomyStructure).filter(Boolean);
    structureById.clear();
    for (const mesh of anatomyMeshes) {
      const structure = structureForMesh(mesh);
      if (structure) structureById.set(structure.id, mesh);
      for (const material of materialList(mesh.material as THREE.Material | THREE.Material[])) rememberMaterial(material);
    }
    availableSystems = Array.from(model.systemCounts.entries())
      .map(([id, count]) => ({ count, id }))
      .sort((a, b) => systemLabel(a.id).localeCompare(systemLabel(b.id)));
    visibility.enableAll(availableSystems);
    body.add(model.group);
    body.updateMatrixWorld(true);
    captureExplodeOrigins();
    updateSourceStatus(shell, `${model.sourceText} · ${structures.length.toLocaleString()} interactive structures.`);
    updateSystemFilterList();
    updateRegions();
    updateBrowser();
    updateVisibility();
    refreshStructureActions();
    logViewerEvent('Atlas Loaded', { structures: anatomyMeshes.length, systems: availableSystems.length });
  }

  function toggleSystemsPanel() {
    const collapsed = !isSystemsPanelCollapsed(shell);
    setSystemsPanelCollapsed(shell, collapsed);
  }

  function toggleDetailsPanel() {
    const collapsed = !isDetailsPanelCollapsed(shell);
    setDetailsPanelCollapsed(shell, collapsed);
  }

  function applyPanelDefaultsForViewport() {
    const compact = compactPanelsQuery.matches;
    setSystemsPanelCollapsed(shell, compact);
    setDetailsPanelCollapsed(shell, compact);
  }

  function animate() {
    animationFrame = requestAnimationFrame(animate);
    updateCameraAnimation(performance.now());
    controls.update();
    renderer.render(scene, camera);
  }

  // Structure-level zoom: after selecting an organ/part, mouse-wheel zooming
  // and trackpad pinch keep that structure under inspection instead of zooming
  // toward an arbitrary point on the full body. OrbitControls still handles
  // the actual dolly/gesture physics.
  shell.canvas.addEventListener('wheel', (event) => {
    if (explodeAmount >= 1 && explodeMaxScroll > 0.05) {
      // In exploded catalogue mode the wheel is a vertical catalogue scroll,
      // not a full-body zoom. Ctrl/trackpad pinch remains available as zoom.
      if (!event.ctrlKey) {
        event.preventDefault();
        // Use a predictable pixel-to-world mapping.  The previous proportional
        // step made a single wheel tick jump too far through the catalogue.
        const delta = THREE.MathUtils.clamp(event.deltaY * 0.012, -1.2, 1.2);
        explodeScroll = THREE.MathUtils.clamp(explodeScroll + delta, 0, explodeMaxScroll);
        shell.explodeScroll.value = String(explodeScroll);
        applyExplodedCameraScroll(false);
        return;
      }
    }
    if (!selected) return;
    const center = selectedStructureCenter(selected);
    if (!center) return;
    controls.target.copy(center);
    controls.cursor.copy(center);
  }, { passive: false });

  shell.explodeScroll.addEventListener('input', () => {
    explodeScroll = THREE.MathUtils.clamp(Number(shell.explodeScroll.value), 0, explodeMaxScroll);
    applyExplodedCameraScroll(false);
  });

  shell.canvas.addEventListener('pointermove', (event) => pick(event, false));
  shell.canvas.addEventListener('pointerdown', (event) => {
    pointerDownPosition.set(event.clientX, event.clientY);
    // A click in exploded/catalogue mode must be a pure selection gesture.
    // Do NOT retarget OrbitControls to the previously selected structure here:
    // doing so changes the camera framing as soon as another part is clicked.
    // The user can explicitly use Focus when they want the camera to move.
    if (selected && explodeAmount < 1) {
      const center = selectedStructureCenter(selected);
      if (center) {
        controls.target.copy(center);
        controls.cursor.copy(center);
      }
    }
    shell.canvas.style.cursor = 'grabbing';
  });
  shell.canvas.addEventListener('pointerup', (event) => {
    const up = new THREE.Vector2(event.clientX, event.clientY);
    if (up.distanceTo(pointerDownPosition) < 8) pick(event, true);
    else shell.canvas.style.cursor = hovered ? 'pointer' : 'grab';
  });
  shell.canvas.addEventListener('pointerleave', () => {
    if (hovered && hovered !== selected) setEmphasis(hovered, false);
    hovered = null;
    shell.canvas.style.cursor = 'grab';
  });

  shell.resetButton.addEventListener('click', resetCamera);
  shell.clearButton.addEventListener('click', () => {
    if (selected) setEmphasis(selected, false);
    selected = null;
    isolated = false;
    contextMode = false;
    updateVisibility();
    showEmptySelection(shell, false);
    refreshStructureActions();
  });
  shell.focusButton.addEventListener('click', () => focusStructure(selected));
  shell.isolateButton.addEventListener('click', toggleIsolate);
  shell.contextButton.addEventListener('click', toggleContext);
  shell.hideSelectedButton.addEventListener('click', hideSelectedStructure);
  shell.restoreHiddenButton.addEventListener('click', restoreHiddenStructures);
  shell.showAllButton.addEventListener('click', () => setAllSystems(true));
  shell.hideAllButton.addEventListener('click', () => setAllSystems(false));
  shell.frontButton.addEventListener('click', () => setView(new THREE.Vector3(0, 0, 1)));
  shell.backButton.addEventListener('click', () => setView(new THREE.Vector3(0, 0, -1)));
  shell.leftButton.addEventListener('click', () => setView(new THREE.Vector3(-1, 0, 0)));
  shell.rightButton.addEventListener('click', () => setView(new THREE.Vector3(1, 0, 0)));
  shell.topButton.addEventListener('click', () => setView(new THREE.Vector3(0, 1, 0)));
  shell.bottomButton.addEventListener('click', () => setView(new THREE.Vector3(0, -1, 0)));
  shell.explodeSlider.addEventListener('input', () => applyExplode(Number(shell.explodeSlider.value)));
  shell.explodeResetButton.addEventListener('click', resetExplode);
  shell.systemsToggleButton.addEventListener('click', toggleSystemsPanel);
  shell.systemTabAllButton.addEventListener('click', () => setSystemTabMode('all'));
  shell.systemTabSystemsButton.addEventListener('click', () => setSystemTabMode('systems'));
  shell.systemTabOrgansButton.addEventListener('click', () => setSystemTabMode('organs'));
  shell.detailsToggleButton.addEventListener('click', toggleDetailsPanel);
  shell.regionSelect.addEventListener('change', () => {
    activeRegion = shell.regionSelect.value;
    updateBrowser();
    updateVisibility();
  });
  shell.searchInput.addEventListener('input', () => search(shell.searchInput.value));
  shell.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      shell.searchInput.value = '';
      hideSearchResults(shell);
      shell.searchInput.blur();
    }
    if (event.key === 'Enter') {
      const first = shell.searchResults.querySelector<HTMLButtonElement>('.search-result');
      first?.click();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== shell.searchInput) {
      event.preventDefault();
      shell.searchInput.focus();
    }
    if (event.key === 'Escape' && document.activeElement !== shell.searchInput) hideSearchResults(shell);
  });
  window.addEventListener('resize', resize);
  compactPanelsQuery.addEventListener('change', applyPanelDefaultsForViewport);

  applyPanelDefaultsForViewport();
  resize();
  animate();

  logViewerEvent('Atlas Load Started');
  void loadAnatomyAtlas({ dracoDecoderPath: '/draco/gltf/', floorY: FLOOR_Y, targetHeight: TARGET_BODY_HEIGHT })
    .then(applyLoadedModel)
    .catch((error) => {
      logViewerError('Atlas Load Failed', error);
      updateSourceStatus(shell, 'Detailed anatomy assets could not be loaded. Check the model files and browser console.');
    });

  return {
    dispose() {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
      compactPanelsQuery.removeEventListener('change', applyPanelDefaultsForViewport);
      controls.dispose();
      renderer.dispose();
    }
  };
}

function scoreSearch(structure: AnatomyStructure, query: string) {
  const name = structure.name.toLowerCase();
  const region = structure.region.toLowerCase();
  const system = structure.system.toLowerCase();
  let score = 0;
  if (name === query) score += 1000;
  else if (name.startsWith(query)) score += 600;
  else if (name.includes(query)) score += 400;
  if (region.includes(query)) score += 80;
  if (system.includes(query)) score += 60;
  if (structure.description.toLowerCase().includes(query)) score += 20;
  return score;
}
