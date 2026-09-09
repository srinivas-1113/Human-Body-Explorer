# Human Anatomy Explorer — Integrated Upgrade

This build upgrades the Open Anatomy Atlas foundation into an interactive anatomy explorer.

## Included in this build

- Interactive Three.js 3D anatomy viewer using the bundled Z-Anatomy asset.
- Direct click and hover structure selection/highlighting.
- Stable source/name-based structure identifiers instead of Three.js UUIDs.
- Search with ranked anatomy results and Enter/Escape keyboard controls.
- System layer toggles and All/None controls.
- Region filtering and a structure browser.
- Focus camera with smooth transitions.
- Isolate selected structure / exit isolate.
- Context mode that makes surrounding visible anatomy translucent.
- Hide selected structure and restore hidden structures.
- Front, Back, Left, Right, Top and Bottom camera views.
- Reset of camera, filters, hidden structures and isolation state.
- Responsive desktop/mobile control panels.
- Expanded selected-structure study information and source status.

## Run

```bash
npm install
npm run dev
```

For production:

```bash
npm run build
npm run preview
```

## Anatomy assets

The bundled Z-Anatomy GLB and manifest are retained from the source project. Review `ASSET_LICENSES.md` before redistributing or using the assets commercially.

## Next production-grade improvements

1. Replace heuristic anatomy classification with source ontology/FMA mappings where available.
2. Add richer anatomy metadata (synonyms, laterality, parent/child relationships, references).
3. Add additional legally compatible datasets only after license review.
4. Add backend persistence and optional AI/RAG services if required.
