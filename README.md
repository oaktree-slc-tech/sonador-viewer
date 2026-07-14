<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<div align="center">
  <h1>Sonador Medical Imaging Viewer</h1>
  <p>
    <strong>A zero-footprint, web-based medical imaging viewer</strong> for the
    <a href="https://sonador.oak-tree.tech">Sonador</a> open-source imaging platform.
    Built on the <a href="http://ohif.org/">Open Health Imaging Foundation (OHIF)</a> Viewer
    and extended with Cornerstone3D rendering, polymorphic segmentation surfaces, and a
    Three.js-based 3D model (M3D) viewer for surgical planning and printing.
  </p>
</div>

<div align="center">
  <a href="https://sonador.oak-tree.tech"><strong>Sonador Platform</strong></a> ·
  <a href="https://eu.sonador.ai">Sonador AI</a> ·
  <a href="https://code.oak-tree.tech/oak-tree/medical-imaging">Source (GitLab)</a> ·
  <a href="https://github.com/oaktree-slc-tech">Community Mirrors (GitHub)</a>
</div>

[![License: MIT][license-image]][license-url]

<!-- prettier-ignore-end -->

---

<div align="center">
  <img src="https://s3.us-east-005.dream.io/acorn8/images/sonador04.studylist-open-drawer.original.png" alt="Sonador study list with the details drawer open" width="90%" />
  <p><em>Sonador 0.4 — Study list with the details drawer open</em></p>
</div>

## About

The **Sonador Medical Imaging Viewer** is the visualization front end for the
[Sonador platform](https://sonador.oak-tree.tech) — an open-source cloud platform for medical
imaging visualization and research. It loads and renders studies from any
[DICOMweb](https://www.dicomstandard.org/dicomweb/)-capable archive and adds the storage,
collaboration, AI, and 3D-modeling capabilities that make Sonador a complete imaging workbench.

The viewer can:

- Render image sets in **2D, MPR, and volumetric 3D** (Cornerstone3D)
- Create, edit, and overlay **segmentations as labelmaps and rendered surfaces**
- View **patient-specific 3D models** (STL / GLB) for surgical navigation and 3D printing (M3D)
- Capture **annotations, measurements, comments, and series tags** as DICOM-SR
- Drive **collaboration, worklists, and access-controlled sharing** from the Sonador study list

> 📘 **New here?** Jump to [Getting Involved](#getting-involved) for a guided on-ramp, or read the
> [Developer Onboarding](https://code.oak-tree.tech/oak-tree/medical-imaging/docs/platform/-/blob/master/dev.onboarding.md)
> guide for a clone-to-first-change walkthrough.

## The Sonador Platform

Sonador exists to help healthcare providers, researchers, and developers **store, visualize, and
quantify** imaging and complex health data using standards-based, collaborative, and scalable
building blocks — without proprietary vendor lock-in. The platform is organized into complementary
subsystems:

| Subsystem | Role |
| --------- | ---- |
| **Sonador IO** | PACS services, secure DICOM/DICOMweb storage, query/retrieval, de-identification, granular permissions, and a Python client for Jupyter |
| **Sonador AI** | Deep-learning tooling (PyTorch/MONAI, TensorFlow), MONAI Label / Deploy integration, and model quality assessment |
| **3D Modeling (M3D)** | Transformation of imaging data into 3D models for surgical navigation and printing; interop with 3D Slicer, ITK-SNAP, and CAD tools |
| **Sonador Viewer** | *This repository* — the browser-based viewer that ties the platform together |

Sonador is developed by [Oak-Tree Technologies](https://www.oak-tree.tech) and
[Sonador AI](https://eu.sonador.ai) as part of a mission to advance human health with personalized
care driven by proven, standards-compliant, open technology. **Community contributions are welcomed
and greatly appreciated.**

## How Sonador Relates to OHIF

The Sonador Viewer was **forked from the OHIF v2 Viewer** and has since been progressively upgraded
to adopt key pieces of the **OHIF v3** architecture and to swap the rendering core over to
**Cornerstone3D**. This gives Sonador the maturity and extension model of OHIF while letting the
platform move independently on the capabilities that matter to its users.

What Sonador adds or changes on top of upstream OHIF:

- **Cornerstone3D rendering core.** Volumetric rendering and MPR are driven by Cornerstone3D, with
  VTK.js used as the underlying data model. The legacy `react-vtkjs-viewport` package is deprecated.
- **Polymorphic segmentation surfaces.** The **Segmentation Editor** extension (`seg-editor`)
  renders labelmaps *and* extracts marching-cubes surfaces (`polySeg` / `@icr/polyseg-wasm`) for
  interactive 3D review.
- **M3D / Three.js 3D model viewer.** A first-class Three.js viewport renders STL and GLB models,
  backed by an `m3dCache` geometry-cache layer that stores parsed geometry in the Cornerstone3D
  geometry cache for fast, reference-counted, per-viewport hydration.
- **Sonador platform integration.** Authentication, access control (ACL), study-list collaboration,
  worklists, series tagging, and secure sharing are wired into the Sonador web application.

> The M3D / Three.js integration and the polymorphic segmentation surfaces are the clearest points
> of differentiation from upstream OHIF — they are what turn the viewer from an image reader into a
> 3D surgical-planning and research tool.

## Where the Source Lives

**The canonical home of the Sonador source code is the Oak-Tree GitLab**, under the
[Medical Imaging group](https://code.oak-tree.tech/oak-tree/medical-imaging). That is where active
development happens, where CI/CD runs, and where issues and merge requests should be filed.

To make community participation easier, Sonador also maintains **read-friendly mirrors on GitHub**
under the [`oaktree-slc-tech`](https://github.com/oaktree-slc-tech) organization. These mirrors exist
to lower the barrier for community developers who prefer the GitHub workflow.

> **Policy:** GitHub mirrors are provided **for community development and convenience**, but the
> **Oak-Tree GitLab is the source of truth.** Canonical history, releases, and review happen on
> GitLab; mirrors track it.

> ⚠️ **The Sonador Viewer does not yet have a public GitHub mirror — one is coming shortly.** Until
> then, develop the viewer against the GitLab repository.

## Highlights from the 0.4 Release

The [Sonador 0.4 release](https://www.oak-tree.tech/blog/sonador04-studylist-collaboration-acl)
brought major study-list, collaboration, and access-control improvements that the viewer plugs into:

<div align="center">
  <img src="https://s3.us-east-005.dream.io/acorn8/images/sonador04.security-share-dialog.original.png" alt="Sonador collaboration and sharing dialog" width="80%" />
  <p><em>Fine-grained, policy-driven sharing built on a zero-trust security model</em></p>
</div>

- **Study list enhancements** — advanced query/search, real-time filtering by modality and metadata,
  and customizable indexed-field access.
- **Details drawer** — quick-access study metadata, series previews, integrated comments, and
  specialized viewer-launch options.
- **Worklist management** — shared study queues with user/group assignment and priority/specialty
  segmentation.
- **Rapid review toolbar** — navigate studies and update status without leaving the viewport.
- **Series tagging** — custom tag libraries aligned to organizational protocols, stored as DICOM-SR
  and rendered in the viewer as findings.
- **Access control & sharing** — fine-grained ACLs and policy-driven cross-organization
  collaboration on a zero-trust framework.

## Getting Started

### Requirements

- [Node 18.12.0+](https://nodejs.org/en/)
- [Yarn 1.22.0+](https://yarnpkg.com/en/docs/install) with workspaces enabled:
  - `yarn config set workspaces-experimental true`

### Install

```bash
# Initialize submodules
git submodule update --init --recursive

# Point the @sonador scope at the Oak-Tree package registry
yarn config set @sonador:registry https://code.oak-tree.tech/api/v4/projects/335/packages/npm/ -g
npm config set @sonador:registry https://code.oak-tree.tech/api/v4/projects/335/packages/npm/ -g

# Restore dependencies and link workspace projects
yarn install
```

### Configure the Environment

The viewer is started through a small set of environment variables:

| Variable | Purpose |
| -------- | ------- |
| `OHIF_HOST` | DNS name of your dev machine. When working against a deployed instance it must be a subdomain of that instance (e.g. `viewer.gke.oak-tree.tech`). Add it to `/etc/hosts`: `127.0.0.1 viewer.gke.oak-tree.tech`. |
| `APP_CONFIG` | API configuration for the target instance. Local: `config/sonador.config-dev.js`. GKE: `config/sonador.imaging-gke.js`. |
| `ENTRY_TARGET` | Always `sonador.index.js`. |

```bash
export OHIF_HOST=viewer.gke.oak-tree.tech
export APP_CONFIG=config/sonador.imaging-gke.js
export ENTRY_TARGET=sonador.index.js

yarn run dev
```

Then open `http://viewer.gke.oak-tree.tech:3000`.

## Commands

Run from the repository root. Individual projects also expose commands in their own
`README.md` / `project.json`.

| Yarn Command | Description |
| ------------ | ----------- |
| `dev` / `start` | Default development experience for the Viewer |
| `dev:project <package-name>` | Develop a single package (`core`, `ui`, `cornerstone`, `vtk`, `viewer3d`, `seg-editor`, …) |
| `test:unit` | Jest multi-project test runner; overall coverage |
| `build` | Production build of the PWA Viewer |
| `build:package` | Production CommonJS build of the Viewer |
| `build:package-all` | CommonJS bundles for all projects |

## Repository Structure

The viewer is maintained as a [Lerna monorepo](https://en.wikipedia.org/wiki/Monorepo): a set of
`platform/` libraries and `extensions/` that compose into the application.

```bash
.
├── extensions               #
│   ├── cornerstone          # 2D image viewing, annotation, segmentation tools
│   ├── dicom-ecg            # DICOM ECG waveform display
│   ├── dicom-html           # Structured Reports rendered as HTML
│   ├── dicom-microscopy     # Whole-slide microscopy viewing
│   ├── dicom-pdf            # DICOM-wrapped PDF viewing
│   ├── dicom-rt             # RT structure-set support
│   ├── dicom-segmentation   # DICOM SEG support
│   ├── dicom-tag-browser    # Browse instance metadata / DICOM tags
│   ├── lesion-tracker       # Longitudinal lesion measurement tracking
│   ├── seg-editor           # Segmentation Editor + polymorphic surface rendering
│   ├── viewer3d             # Cornerstone3D viewports + Three.js M3D model viewer
│   ├── viewer3d-volume      # Cornerstone3D volume-rendering UI
│   └── vtk                  # VTK.js ↔ Cornerstone3D volume / MPR integration
│
├── platform                 #
│   ├── core                 # Framework-agnostic business logic and services
│   ├── i18n                 # Internationalization support
│   ├── ui                   # React component library (classic)
│   ├── ui-next              # Newer UI primitives ported from OHIF v3
│   └── viewer               # Connects platform and extension projects
│
├── lerna.json               # Monorepo settings
├── package.json             # Shared devDependencies and commands
└── README.md                # This file
```

## Documentation

Architecture and developer documentation for the platform lives in the
[Sonador platform docs](https://code.oak-tree.tech/oak-tree/medical-imaging/docs/platform) (also
rendered as a
[GitLab wiki](https://code.oak-tree.tech/oak-tree/medical-imaging/imaging-development-env/-/wikis/home)).
Especially relevant pages for viewer developers:

- **Developer Onboarding** — a guided on-ramp from cloning to your first change
- **Viewer Architecture (OHIF + Cornerstone3D)** — how the rendering stack fits together
- **VTK ↔ Cornerstone3D Integration** — how `@ohif/extension-vtk` renders volumes and MPR
- **Segmentation Editor & Surface Rendering** — the seg editor and polymorphic surfaces
- **3D Model Viewer (Three.js / M3D)** — STL/GLB viewing and the `m3dCache` layer

## Getting Involved

We want contributing to be approachable whether you are fixing a typo or building a new extension.

1. **Find a reason to participate.** If you work with medical images — as a clinician, researcher,
   or engineer — Sonador is built to be customized for *your* workflow without forking.
2. **Get tooling set up quickly.** Follow [Getting Started](#getting-started); the dev environment
   runs entirely in the browser against any DICOMweb source.
3. **Build your skills.** The [documentation](#documentation) walks through the architecture and the
   patterns the codebase relies on.
4. **Find a task.** Browse issues on the
   [Oak-Tree GitLab](https://code.oak-tree.tech/oak-tree/medical-imaging) (or the community
   [GitHub mirrors](https://github.com/oaktree-slc-tech)) and pick something that fits.
5. **Ask a human.** Open an issue or merge request — maintainers are happy to help you land your
   first change.
6. **Get credited.** Contributions are recognized in release notes and project history; thank you
   for helping the platform grow.

Please review [`CONTRIBUTING.md`](CONTRIBUTING.md) and our
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before opening a merge request.

## Acknowledgments

The Sonador Viewer builds on the [OHIF Viewer](https://ohif.org/) and the broad open-source medical
imaging community. To acknowledge OHIF in an academic publication, please cite:

> _LesionTracker: Extensible Open-Source Zero-Footprint Web Viewer for Cancer Imaging Research and
> Clinical Trials_
>
> Trinity Urban, Erik Ziegler, Rob Lewis, Chris Hafey, Cheryl Sadow, Annick D. Van den Abbeele and
> Gordon J. Harris
>
> _Cancer Research_, November 1 2017 (77) (21) e119-e122 DOI:
> [10.1158/0008-5472.CAN-17-0334](https://www.doi.org/10.1158/0008-5472.CAN-17-0334)

## License

MIT © [Open Health Imaging Foundation](https://github.com/OHIF) and
[Oak-Tree Technologies](https://www.oak-tree.tech)

<!-- prettier-ignore-start -->
[license-image]: https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square
[license-url]: LICENSE
<!-- prettier-ignore-end -->
