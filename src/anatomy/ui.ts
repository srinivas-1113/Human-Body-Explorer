import type { AnatomyStructure, AnatomySystem, AnatomySystemOption } from './types';
import { systemLabel } from './structureMetadata';

export type AnatomyShell = {
  canvas: HTMLCanvasElement;
  appNameEl: HTMLElement;
  clearButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  focusButton: HTMLButtonElement;
  isolateButton: HTMLButtonElement;
  contextButton: HTMLButtonElement;
  hideSelectedButton: HTMLButtonElement;
  restoreHiddenButton: HTMLButtonElement;
  showAllButton: HTMLButtonElement;
  hideAllButton: HTMLButtonElement;
  frontButton: HTMLButtonElement;
  backButton: HTMLButtonElement;
  leftButton: HTMLButtonElement;
  rightButton: HTMLButtonElement;
  topButton: HTMLButtonElement;
  bottomButton: HTMLButtonElement;
  explodeSlider: HTMLInputElement;
  explodeValue: HTMLElement;
  explodeResetButton: HTMLButtonElement;
  explodeScroll: HTMLInputElement;
  explodeScrollWrap: HTMLElement;
  searchInput: HTMLInputElement;
  searchResults: HTMLElement;
  regionSelect: HTMLSelectElement;
  systemFiltersEl: HTMLElement;
  systemTabAllButton: HTMLButtonElement;
  systemTabSystemsButton: HTMLButtonElement;
  systemTabOrgansButton: HTMLButtonElement;
  browserEl: HTMLElement;
  detailsPanel: HTMLElement;
  systemsPanel: HTMLElement;
  detailsToggleButton: HTMLButtonElement;
  systemsToggleButton: HTMLButtonElement;
  nameEl: HTMLElement;
  metaEl: HTMLElement;
  descriptionEl: HTMLElement;
  functionEl: HTMLElement;
  sourceEl: HTMLElement;
  visibleCountEl: HTMLElement;
  selectionStatusEl: HTMLElement;
};

function button(id: string, label: string, className = '') {
  return `<button type="button" id="${id}" class="tool-button ${className}">${label}</button>`;
}

export function mountAnatomyShell(root: HTMLDivElement): AnatomyShell {
  root.innerHTML = `
    <canvas class="viewer" aria-label="Interactive 3D human anatomy viewer"></canvas>

    <header class="topbar">
      <div class="brand">
        <p class="eyebrow">Interactive anatomy atlas</p>
        <div class="brand-row">
          <h1 id="app-name">Human Anatomy Explorer</h1>
          <span class="brand-version">3D</span>
        </div>
      </div>
      <div class="topbar-tools">
        <label class="search-box" aria-label="Search anatomy">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="anatomy-search" type="search" placeholder="Find a structure" autocomplete="off" />
          <kbd>/</kbd>
        </label>
        <div class="toolbar">
          ${button('reset-view', 'Reset view')}
          ${button('clear-selection', 'Clear')}
        </div>
      </div>
    </header>

    <aside class="systems-panel" id="systems-panel" aria-label="Anatomy systems">
      <div class="panel-titlebar">
        <div>
          <p class="panel-label">Systems</p>
          <p id="visible-count">Loading anatomy...</p>
        </div>
        <button type="button" id="toggle-systems-panel" class="panel-toggle" aria-controls="systems-body" aria-expanded="true" aria-label="Minimize systems panel">−</button>
      </div>
      <div class="collapsible-body" id="systems-body">
        <div class="system-tabs" role="tablist" aria-label="Anatomy filter">
          <button type="button" id="system-tab-all" class="active" role="tab" aria-selected="true">All</button>
          <button type="button" id="system-tab-systems" role="tab" aria-selected="false">Systems</button>
          <button type="button" id="system-tab-organs" role="tab" aria-selected="false">Organs</button>
        </div>
        <div class="filter-row">
          <label class="field-label" for="region-select">Region</label>
          <select id="region-select">
            <option value="all">All regions</option>
          </select>
        </div>
        <div class="quick-actions">
          ${button('show-all', 'Show all', 'small')}
          ${button('hide-all', 'Hide all', 'small')}
          ${button('restore-hidden', 'Restore', 'small')}
        </div>
        <div class="section-heading">
          <span>Body systems</span>
          <span class="section-note">visibility</span>
        </div>
        <div class="system-filters" id="system-filters" aria-label="Anatomy system filters"></div>
        <div class="section-heading browser-heading">
          <span>Structures</span>
          <span class="section-note" id="browser-count">—</span>
        </div>
        <div class="browser" id="structure-browser"></div>
      </div>
    </aside>

    <section class="search-results" id="search-results" aria-live="polite" hidden></section>

    <aside class="details-panel" id="details-panel" aria-label="Selected anatomy details">
      <div class="panel-titlebar">
        <div>
          <p class="panel-label">Selected anatomy</p>
          <p class="selection-status" id="selection-status">Nothing selected</p>
        </div>
        <button type="button" id="toggle-details-panel" class="panel-toggle" aria-controls="details-body" aria-expanded="true" aria-label="Minimize details panel">−</button>
      </div>
      <div class="collapsible-body" id="details-body">
        <div class="selected-kicker">ANATOMY</div>
        <h2 id="part-name">Select anatomy</h2>
        <p id="part-meta" class="part-meta">Click a visible structure in the model.</p>
        <p id="part-description">Use search, system layers or direct selection to explore the 3D body.</p>
        <div class="detail-card">
          <p class="detail-label">Function / study note</p>
          <p id="part-function">The selected structure's study information will appear here.</p>
        </div>
        <div class="structure-actions">
          ${button('focus-selected', 'Focus', 'accent')}
          ${button('isolate-selected', 'Isolate', 'accent')}
          ${button('context-selected', 'Context', 'accent')}
          ${button('hide-selected', 'Hide', 'accent')}
        </div>
        <p class="source" id="source-status">Loading anatomy assets...</p>
      </div>
    </aside>

    <div class="bottom-controls" aria-label="3D controls">
      <div class="view-controls" aria-label="View orientation">
        <span class="control-label">VIEW</span>
        ${button('view-front', 'Front', 'bottom-view-button')}
        ${button('view-back', 'Back', 'bottom-view-button')}
        ${button('view-left', 'Left', 'bottom-view-button')}
        ${button('view-right', 'Right', 'bottom-view-button')}
        ${button('view-top', 'Top', 'bottom-view-button')}
        ${button('view-bottom', 'Bottom', 'bottom-view-button')}
      </div>
      <div class="explode-controls" aria-label="Explode anatomy control">
        <div class="explode-heading">
          <span class="dock-title">Explode anatomy</span>
          <span class="explode-value" id="explode-value">0%</span>
        </div>
        <div class="explode-row">
          <input id="explode-slider" type="range" min="0" max="100" value="0" step="1" aria-label="Explode anatomy percentage" />
          <button type="button" id="explode-reset" class="explode-reset">Reset</button>
        </div>
        <div class="explode-caption"><span>Assembled</span><span>Parts spread</span></div>
      </div>
    </div>

    <div class="explode-scroll" id="explode-scroll-wrap" aria-label="Exploded anatomy scroll">
      <label for="explode-scroll">Exploded anatomy position</label>
      <input id="explode-scroll" type="range" min="0" max="0" value="0" step="0.01" aria-label="Scroll through exploded anatomy" />
    </div>

    <div class="hint"><strong>Click</strong> a structure to inspect · press <kbd>/</kbd> to search</div>
  `;

  const q = <T extends HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing anatomy UI element: ${selector}`);
    return element;
  };

  return {
    canvas: q<HTMLCanvasElement>('.viewer'),
    appNameEl: q('#app-name'),
    clearButton: q('#clear-selection'),
    resetButton: q('#reset-view'),
    focusButton: q('#focus-selected'),
    isolateButton: q('#isolate-selected'),
    contextButton: q('#context-selected'),
    hideSelectedButton: q('#hide-selected'),
    restoreHiddenButton: q('#restore-hidden'),
    showAllButton: q('#show-all'),
    hideAllButton: q('#hide-all'),
    frontButton: q('#view-front'),
    backButton: q('#view-back'),
    leftButton: q('#view-left'),
    rightButton: q('#view-right'),
    topButton: q('#view-top'),
    bottomButton: q('#view-bottom'),
    explodeSlider: q('#explode-slider'),
    explodeValue: q('#explode-value'),
    explodeResetButton: q('#explode-reset'),
    explodeScroll: q<HTMLInputElement>('#explode-scroll'),
    explodeScrollWrap: q('#explode-scroll-wrap'),
    searchInput: q('#anatomy-search'),
    searchResults: q('#search-results'),
    regionSelect: q('#region-select'),
    systemFiltersEl: q('#system-filters'),
    systemTabAllButton: q('#system-tab-all'),
    systemTabSystemsButton: q('#system-tab-systems'),
    systemTabOrgansButton: q('#system-tab-organs'),
    browserEl: q('#structure-browser'),
    detailsPanel: q('#details-panel'),
    systemsPanel: q('#systems-panel'),
    detailsToggleButton: q('#toggle-details-panel'),
    systemsToggleButton: q('#toggle-systems-panel'),
    nameEl: q('#part-name'),
    metaEl: q('#part-meta'),
    descriptionEl: q('#part-description'),
    functionEl: q('#part-function'),
    sourceEl: q('#source-status'),
    visibleCountEl: q('#visible-count'),
    selectionStatusEl: q('#selection-status')
  };
}

export type SystemTab = 'all' | 'systems' | 'organs';

export function setSystemTab(shell: AnatomyShell, tab: SystemTab) {
  const buttons: Array<[HTMLButtonElement, SystemTab]> = [
    [shell.systemTabAllButton, 'all'],
    [shell.systemTabSystemsButton, 'systems'],
    [shell.systemTabOrgansButton, 'organs']
  ];
  for (const [buttonEl, buttonTab] of buttons) {
    const active = buttonTab === tab;
    buttonEl.classList.toggle('active', active);
    buttonEl.setAttribute('aria-selected', String(active));
  }
}

function setPanelCollapsed(panel: HTMLElement, buttonEl: HTMLButtonElement, collapsed: boolean) {
  panel.classList.toggle('collapsed', collapsed);
  buttonEl.textContent = collapsed ? 'Show' : 'Minimize';
  buttonEl.setAttribute('aria-expanded', String(!collapsed));
}

export function setSystemsPanelCollapsed(shell: AnatomyShell, collapsed: boolean) {
  setPanelCollapsed(shell.systemsPanel, shell.systemsToggleButton, collapsed);
}

export function setDetailsPanelCollapsed(shell: AnatomyShell, collapsed: boolean) {
  setPanelCollapsed(shell.detailsPanel, shell.detailsToggleButton, collapsed);
}

export function isSystemsPanelCollapsed(shell: AnatomyShell) {
  return shell.systemsPanel.classList.contains('collapsed');
}

export function isDetailsPanelCollapsed(shell: AnatomyShell) {
  return shell.detailsPanel.classList.contains('collapsed');
}

export function showEmptySelection(shell: AnatomyShell, compact: boolean) {
  shell.nameEl.textContent = 'Select anatomy';
  shell.metaEl.textContent = 'Click a visible structure in the model.';
  shell.selectionStatusEl.textContent = 'Nothing selected';
  shell.descriptionEl.textContent = 'Use search, system layers or direct selection to explore the 3D body.';
  shell.functionEl.textContent = 'The selected structure\'s study information will appear here.';
  if (compact) setDetailsPanelCollapsed(shell, true);
}

export function showSelectedStructure(shell: AnatomyShell, structure: AnatomyStructure, compact: boolean) {
  shell.nameEl.textContent = structure.name;
  shell.metaEl.textContent = `${structure.region} · ${systemLabel(structure.system)} · ${structure.source}`;
  shell.selectionStatusEl.textContent = `ID ${structure.id}`;
  shell.descriptionEl.textContent = structure.description;
  shell.functionEl.textContent = studyFunction(structure);
  // Selecting any anatomical structure should always open the details
  // panel. The reference app keeps the inspector available for bones,
  // muscles, vessels, organs, tendons/ligaments, and every other mesh —
  // not only for organs selected from the exploded catalogue.
  setDetailsPanelCollapsed(shell, false);
  if (compact) setSystemsPanelCollapsed(shell, true);
}

function studyFunction(structure: AnatomyStructure) {
  const text = `${structure.name} ${structure.description}`.toLowerCase();
  if (text.includes('muscle')) return 'Supports movement, posture, stabilization or force transfer in its anatomical region.';
  if (text.includes('arter') || text.includes('vein') || text.includes('vessel')) return 'Supports blood transport between the heart, organs and peripheral tissues.';
  if (text.includes('nerve') || structure.system === 'nervous') return 'Carries or coordinates signals that support sensation, movement and body regulation.';
  if (structure.system === 'bone') return 'Provides structural support, protection, leverage and a framework for soft tissues.';
  if (structure.system === 'respiratory') return 'Contributes to airflow, airway protection or gas exchange.';
  if (structure.system === 'digestive') return 'Contributes to digestion, absorption, storage or movement of gastrointestinal contents.';
  if (structure.system === 'urinary') return 'Contributes to filtration, urine transport, storage or elimination.';
  if (structure.system === 'reproductive') return 'Contributes to reproductive anatomy or associated reproductive functions.';
  return 'Provides anatomical context for studying the structure, its location and its relationship to nearby tissues.';
}

export function updateSourceStatus(shell: AnatomyShell, sourceText: string) {
  shell.sourceEl.textContent = sourceText;
}

export function updateStructureActions(shell: AnatomyShell, hasSelection: boolean, hiddenCount: number, isolated: boolean, contextMode: boolean) {
  shell.focusButton.disabled = !hasSelection;
  shell.isolateButton.disabled = !hasSelection;
  shell.contextButton.disabled = !hasSelection;
  shell.hideSelectedButton.disabled = !hasSelection;
  shell.restoreHiddenButton.disabled = hiddenCount === 0;
  shell.restoreHiddenButton.textContent = hiddenCount > 0 ? `Restore hidden (${hiddenCount})` : 'Restore hidden';
  shell.isolateButton.textContent = isolated ? 'Exit isolate' : 'Isolate';
  shell.contextButton.textContent = contextMode ? 'Solid context' : 'Context';
}

export function updateVisibleStructureCount(shell: AnatomyShell, visibleCount: number, totalCount: number, filteredCount: number) {
  shell.visibleCountEl.textContent = `${visibleCount.toLocaleString()} visible · ${filteredCount.toLocaleString()} filtered · ${totalCount.toLocaleString()} total`;
}

export function renderSystemFilters(
  container: HTMLElement,
  options: AnatomySystemOption[],
  enabledSystems: ReadonlySet<AnatomySystem>,
  onToggle: (system: AnatomySystem, enabled: boolean) => void
) {
  container.innerHTML = '';
  for (const option of options) {
    const label = document.createElement('label');
    label.className = 'system-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabledSystems.has(option.id);
    checkbox.dataset.system = option.id;
    checkbox.addEventListener('change', () => onToggle(option.id, checkbox.checked));
    const name = document.createElement('span');
    name.textContent = systemLabel(option.id);
    const count = document.createElement('strong');
    count.textContent = String(option.count);
    label.append(checkbox, name, count);
    container.append(label);
  }
}

export function renderRegions(select: HTMLSelectElement, regions: string[], selected: string) {
  select.innerHTML = '<option value="all">All regions</option>';
  for (const region of regions) {
    const option = document.createElement('option');
    option.value = region;
    option.textContent = region;
    option.selected = region === selected;
    select.append(option);
  }
}

export function renderSearchResults(
  container: HTMLElement,
  results: AnatomyStructure[],
  onSelect: (structureId: string) => void
) {
  container.innerHTML = '';
  if (!results.length) {
    container.innerHTML = '<div class="search-empty">No matching anatomy found.</div>';
    container.hidden = false;
    return;
  }
  const heading = document.createElement('div');
  heading.className = 'search-heading';
  heading.textContent = `${results.length} matching structures`;
  container.append(heading);
  for (const structure of results.slice(0, 24)) {
    const buttonEl = document.createElement('button');
    buttonEl.type = 'button';
    buttonEl.className = 'search-result';
    buttonEl.dataset.id = structure.id;
    buttonEl.innerHTML = `<strong></strong><span></span>`;
    buttonEl.querySelector('strong')!.textContent = structure.name;
    buttonEl.querySelector('span')!.textContent = `${structure.region} · ${systemLabel(structure.system)}`;
    buttonEl.addEventListener('click', () => onSelect(structure.id));
    container.append(buttonEl);
  }
  container.hidden = false;
}

export function hideSearchResults(shell: AnatomyShell) {
  shell.searchResults.hidden = true;
  shell.searchResults.innerHTML = '';
}

export function renderBrowser(
  container: HTMLElement,
  structures: AnatomyStructure[],
  onSelect: (structureId: string) => void
) {
  container.innerHTML = '';
  const limited = structures.slice(0, 72);
  for (const structure of limited) {
    const buttonEl = document.createElement('button');
    buttonEl.type = 'button';
    buttonEl.className = 'browser-item';
    buttonEl.innerHTML = '<span></span><small></small>';
    buttonEl.querySelector('span')!.textContent = structure.name;
    buttonEl.querySelector('small')!.textContent = systemLabel(structure.system);
    buttonEl.addEventListener('click', () => onSelect(structure.id));
    container.append(buttonEl);
  }
  if (!limited.length) {
    container.innerHTML = '<p class="browser-empty">No structures match this region.</p>';
  }
}

export function setBrowserCount(shell: AnatomyShell, count: number) {
  const el = shell.browserEl.parentElement?.querySelector('#browser-count');
  if (el) el.textContent = `${count.toLocaleString()} available`;
}
