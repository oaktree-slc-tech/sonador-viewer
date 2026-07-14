# Sonador Viewer — Project Reference

This is the **Sonador Viewer**, a medical-imaging web viewer derived from OHIF v3 and built on
Cornerstone3D, VTK.js, and Three.js. It is a Lerna monorepo (`platform/` + `extensions/`).

## Platform Documentation

Authoritative architecture and developer docs live in a **separate** repository (a GitLab wiki):

- **Canonical remote:** https://code.oak-tree.tech/oak-tree/medical-imaging/docs/platform
- **Rendered wiki:** https://code.oak-tree.tech/oak-tree/medical-imaging/imaging-development-env/-/wikis/home

The docs are flat-file markdown (`dev.*` page names; internal links omit the `.md` extension). **If
you have a local checkout of the docs repo, prefer reading from it directly** to avoid extra network
calls to GitLab.

**Consult these docs when working in this repo, and keep them current** when you change
architecture, patterns, or components. They are intended as a knowledgebase for both human and
AI-facilitated development.

### Most relevant pages for this repo
Page names below are docs-repo page names (append `.md` when reading files).

| Topic | Doc |
|-------|-----|
| **Start here (new devs)** | `dev.onboarding` |
| Viewer architecture (monorepo, subsystems) | `dev.architecture-sonador.ohif` |
| Frontend developer index / navigation | `dev.ohif-frontend` |
| Cornerstone3D integration reference (cache, rendering, state) | `dev.ohif-frontend.cornerstone3d-architecture` |
| Cornerstone3D tools & interaction | `dev.ohif-frontend.cornerstone3d-tools` |
| **VTK ↔ Cornerstone3D** (`extensions/vtk`; volumes/MPR/volume rendering) | `dev.ohif-frontend.vtk-cornerstone3d` |
| **Segmentation editor & surface rendering** (`extensions/seg-editor`) | `dev.ohif-frontend.segmentation-editor` |
| **3D model viewer + m3dCache** (`extensions/viewer3d`; STL/GLB) | `dev.ohif-frontend.m3d-viewer` |
| Legacy `react-vtkjs-viewport` (**deprecated**) | `dev.ohif-frontend.react-vtkjs-viewports` |
| Data services (one-way dataflow, measurement, DICOM metadata) | `dev.ohif-frontend.service-overview` |

## Codebase map (extensions/)
- `cornerstone` — legacy Cornerstone (classic) 2D viewport
- `vtk` (`@ohif/extension-vtk`) — volumetric stack: VTK.js as data model, Cornerstone3D renders;
  `Cornerstone3DBaseView` hierarchy and `src/utils/cornerstone3d.js` integration boundary
- `seg-editor` — segmentation editor with 3D polymorphic surface rendering
- `viewer3d` — Three.js STL/GLB model viewer + `m3dCache` (geometry stored in the C3D geometry cache)
- `viewer3d-volume` — standalone 3D volume rendering viewport

## Conventions
- The docs are a flat-file GitLab wiki: no frontmatter; `# Title` first line; internal links are
  `[text](dev.page-name)` (no `.md`); ASCII diagrams over mermaid; `**IMPORTANT:**` / `> 📘` callouts.
- `react-vtkjs-viewport` is deprecated — do not build new features on it (see the doc above).
