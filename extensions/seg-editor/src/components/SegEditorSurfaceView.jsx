// Segmentation Editor 3D editing canvas (ohif-viewers#142 follow-on): a Three.js view of the
// editor's segmentation surfaces, shown in the 3D tab while the 3D tool palette is selected.
//
// - Scene: the M3D viewer's M3DModelView (shared with STL/GLB display). Each segment's surface is
//   read from the Cornerstone3D geometry cache, where polymorphic segmentation stores it for the
//   vol3d labelmap, and converted to a Three.js mesh in world (patient) coordinates.
// - It is set up to look like the VTK 3D view it replaces: VTK's lighting (M3DModelView
//   lightingModel="vtk") and a parallel projection, since Cornerstone3D's 3D viewports always use
//   one. The camera is synchronized with the VTK view on every switch, in both directions.
// - Presentation follows the Cornerstone3D segmentation state, the same state the side panel
//   edits: colour from the segmentation's colour LUT, visibility from the VTK 3D viewport's
//   representation (per segment and whole-representation), and lock shown as wireframe (the M3D
//   viewer's convention).
// - Geometry follows the surface: when Cornerstone3D updates it (2D edits via the surface sync),
//   the meshes are rebuilt, and segments added or removed are added to or removed from the scene.
//
// - 3D tools (ohif-viewers#142, §10.2, §11 and §13; ohif-viewers#148): the Lasso and Paint tools
//   build one triangle selection of the active segment's surface, after three-mesh-bvh's
//   lasso-selection and triangle-painting examples: a lasso (or box) over the view selects the
//   visible triangles inside it, shown as their points over a faint face tint; a brush (a sphere
//   on the surface under the pointer) paints the connected triangles it covers, shown as tinted
//   faces (right rotates, middle pans, the wheel zooms). Delete removes the selected triangles:
//   the holes are patched and the edited surface is shown at once (surfaceEdits), while the voxels
//   it no longer contains are removed from the working labelmap in the background. Smooth evens
//   the selected region out with its edge pinned, shown for Apply / Cancel, and the labelmap
//   follows the moved surface the same way.
//
// The view stays mounted once created; while hidden its render loop is paused.

import React, { Component } from 'react';
import { cache as c3dCache, eventTarget as c3dEventTarget } from '@cornerstonejs/core';
import {
  Enums as c3dToolsEnums,
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import _ from 'lodash';
import PropTypes from 'prop-types';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
} from 'three';

import {
  createSurfaceModel,
  disposeSurfaceModel,
  M3DModelView,
  MIMETYPE_STL,
  surfaceToBufferGeometry,
} from '@ohif/extension-viewerm3d';
import { applyViewOrientationToModelView,LoadingIndicator } from '@ohif/extension-vtk';

import {
  cutAndPatch,
  DELETE_STEPS,
  EMPTY_SURFACE,
  repairSurface,
  SurfaceEditCancelledError,
} from '../threeDTools/deleteSelection';
import LassoInteraction from '../threeDTools/LassoInteraction';
import { combineSelection, SELECTION_MODES, selectTrianglesInLasso } from '../threeDTools/lassoSelection';
import {
  growTriangles,
  largestConnectedTriangles,
  polysToTriangles,
  shrinkTriangles,
  triangleComponents,
  trianglesVertices,
} from '../threeDTools/meshRepair';
import { isOwnSurfaceWrite } from '../threeDTools/ownWrites';
import PaintInteraction from '../threeDTools/PaintInteraction';
import {
  collectTrianglesInSphere,
  connectedTriangles,
  raycastSurfaces,
} from '../threeDTools/paintSelection';
import {
  assembleCutInWorker,
  diagnoseSurfaceInWorker,
  getLabelmapForEdit,
  patchHolesInWorker,
  prepareCutInWorker,
  prepareRepairInWorker,
  smoothInWorker,
  triangleTopologyInWorker,
} from '../threeDTools/segmentEdits';
import { createSurfaceEditMemo, WRITE_KINDS } from '../threeDTools/surfaceEditMemo';
import {
  queueSurfaceEditWrite,
  recordSurfaceEdit,
  setCachedSurface,
  SURFACE_CHANGED_REQUEST,
} from '../threeDTools/surfaceEdits';
import {
  begin3DToolJob,
  end3DToolJob,
  get3DEditOptions,
  get3DSmoothOptions,
  get3DToolState,
  handle3DToolRequest,
  is3DSelectionTool,
  is3DTargetEditable,
  PAINT_MODES,
  set3DLastEdit,
  set3DPreview,
  set3DSelectionCount,
  set3DSurfaceHealth,
  set3DToolTarget,
  setActive3DTool,
  subscribe3DToolState,
  THREE_D_TOOLS,
} from '../threeDTools/threeDToolState';
import { ensureBoundsTree, releaseBoundsTree } from '../threejs/meshBvh';


const SurfaceRepresentation = c3dToolsEnums.SegmentationRepresentations.Surface;

// Camera bindings while a 3D tool owns the left button
const TOOL_MOUSE_ACTIONS = { left: 'none', right: 'rotate', middle: 'pan', wheel: 'zoom' };

// Selection display, in tints of the segment's colour: faces a little over half way to white; the
// brush's edges and points the same, subdued; the lasso's edges and points much nearer white, so
// the two tools read differently at a glance
const FACE_TINT_TOWARD_WHITE = 0.55;
const PAINT_POINT_TINT_TOWARD_WHITE = 0.7;
const LASSO_EDGE_TINT_TOWARD_WHITE = 0.8;
const LASSO_POINT_TINT_TOWARD_WHITE = 0.95;
const FALLBACK_SEGMENT_COLOR = '#ffd600';
const WHITE = new Color(1, 1, 1);
// Patches of an edit awaiting Apply / Cancel
const PATCH_TINT_COLOR = 0x4fc3f7;
// The original surface of the edited region, ghosted behind a preview for comparison
const GHOST_COLOR = 0xffffff;
// Open edges, and non-manifold edges, of the target's surface (Show mesh issues)
const OPEN_EDGE_COLOR = 0xff5252;
const NON_MANIFOLD_EDGE_COLOR = 0xffa726;

// Progress messages for the edit overlay (the steps before the edited surface is shown)
const DELETE_STEP_MESSAGES = {
  [DELETE_STEPS.cut]: 'Removing the selected points...',
  [DELETE_STEPS.patch]: 'Closing the surface...',
  [DELETE_STEPS.smooth]: 'Smoothing the selected points...',
};

// A smooth shown for Apply / Cancel is recomputed this long after its last setting change
const SMOOTH_RERUN_DELAY_MS = 250;

/** A tint of a CSS colour towards white (0: the colour, 1: white). */
export function selectionTint(cssColor, towardWhite) {
  const color = new Color();
  try {
    color.set(cssColor || FALLBACK_SEGMENT_COLOR);
  } catch (err) {
    color.set(FALLBACK_SEGMENT_COLOR);
  }
  return color.lerp(WHITE, towardWhite);
}

/** Segment surfaces currently in the geometry cache: [{ segmentIndex, geometryId, surface }] */
export function getCachedSurfaces(segmentationId) {
  const segmentation = c3dSegmentations.state.getSegmentation(segmentationId);
  const geometryIds = segmentation?.representationData?.Surface?.geometryIds;
  if (!geometryIds) {
    return [];
  }

  const surfaces = [];
  geometryIds.forEach((geometryId, segmentIndex) => {
    const surface = c3dCache.getGeometry(geometryId)?.data;
    if (surface?.points?.length && surface?.polys?.length) {
      surfaces.push({ segmentIndex: Number(segmentIndex), geometryId, surface });
    }
  });
  return surfaces;
}

const _sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const _length = v => Math.hypot(v[0], v[1], v[2]);
const _halfAngle = degrees => (degrees * Math.PI) / 360;

/**
 * Cornerstone3D camera -> M3DModelView camera. A parallel-projection camera's zoom is its
 * parallelScale; a perspective one's is converted to the parallel scale that frames the focal
 * plane the same way.
 */
export function vtkToViewCamera(camera) {
  if (!camera?.position || !camera?.focalPoint) {
    return undefined;
  }
  const parallelScale = camera.parallelProjection
    ? camera.parallelScale
    : _length(_sub(camera.position, camera.focalPoint)) * Math.tan(_halfAngle(camera.viewAngle || 30));

  return {
    position: [...camera.position],
    target: [...camera.focalPoint],
    up: camera.viewUp ? [...camera.viewUp] : undefined,
    parallelScale,
  };
}

/**
 * M3DModelView camera -> Cornerstone3D camera, in the projection of the VTK view (`reference`).
 * For a perspective VTK view the camera is placed at the distance that frames the focal plane with
 * the same height.
 */
export function viewToVtkCamera(camera, reference = {}) {
  if (!camera?.position || !camera?.target) {
    return undefined;
  }
  const vtkCamera = { focalPoint: [...camera.target], viewUp: camera.up ? [...camera.up] : undefined };

  if (reference.parallelProjection !== false) {
    return { ...vtkCamera, position: [...camera.position], parallelScale: camera.parallelScale };
  }

  const direction = _sub(camera.position, camera.target);
  const length = _length(direction) || 1;
  const distance = camera.parallelScale / Math.tan(_halfAngle(reference.viewAngle || 30));
  return {
    ...vtkCamera,
    position: camera.target.map((value, i) => value + (direction[i] / length) * distance),
  };
}

/** CSS colour for a segment from a Cornerstone3D colour LUT entry ([r, g, b, a], 0-255) */
export function lutColorToCss(color) {
  if (!color) {
    return undefined;
  }
  const [r, g, b] = color;
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}


export default class SegEditorSurfaceView extends Component {

  static propTypes = {
    // The vol3d segmentation the surfaces were computed from
    segmentationId: PropTypes.string.isRequired,
    // The VTK 3D viewport showing the same surfaces: source of per-segment visibility
    referenceViewportId: PropTypes.string,
    // Colour LUT shared by the editor's 2D and 3D representations
    colorLUTIndex: PropTypes.number,
    // Camera of the VTK 3D view (Cornerstone3D ICamera): matched each time the view is shown
    getReferenceCamera: PropTypes.func,
    // Apply a camera to the VTK 3D view: called with this view's camera each time it is hidden
    setReferenceCamera: PropTypes.func,
    // Shown (render loop running) or hidden (paused)
    active: PropTypes.bool,
    // Surface computation finished (the geometry cache holds the surfaces)
    surfaceReady: PropTypes.bool,
    // Shown (with the viewport loading indicator) until the surfaces exist; none while the editor's
    // own surface status is showing
    noSurfaceMessage: PropTypes.string,
    // The working segmentation (edited in 2D): its active segment is the 3D tools' target, its
    // lock state is shown, and deletes are written to its labelmap
    editSegmentationId: PropTypes.string,
    // ({ title, message, confirmText, cancelText }) => Promise<boolean>
    confirm: PropTypes.func,
    // ({ type, title, message }) => void
    notify: PropTypes.func,
    // (error) => void: a delete failed
    onEditError: PropTypes.func,
    // (fn) => fn(): runs a labelmap write made for the surface, which must not rebuild it
    withOwnLabelmapEdit: PropTypes.func,
    computeTopology: PropTypes.func,
    // i18n (react-i18next `t`, SegmentationEditor namespace)
    t: PropTypes.func,
  };

  static defaultProps = {
    active: true,
    surfaceReady: false,
    noSurfaceMessage: 'The 3D surface is not available yet.',
    withOwnLabelmapEdit: fn => fn(),
    // The triangle topology of a surface, built off the main thread (tests inject a local one)
    computeTopology: surface => triangleTopologyInWorker(surface),
    t: (key, options) => (options ? key.replace(/{{(\w+)}}/g, (_m, name) => options[name]) : key),
  };

  state = {
    // Models are created once, when the first surfaces are available; later changes are applied
    // to the live scene through the M3DModelView api.
    initialModels: null,
    // Step of a running delete (DELETE_STEPS), shown as an overlay
    deleteStep: null,
  };

  constructor(props) {
    super(props);
    this.api = null;
    this._sources = new Map();       // geometryId -> the surface points array a mesh was built from
    this._onCreated = this._onCreated.bind(this);
    this._onSegmentationModified = this._onSegmentationModified.bind(this);
    this._onRepresentationModified = this._onRepresentationModified.bind(this);
    this._apply3DToolState = this._apply3DToolState.bind(this);

    // 3D tools
    this._lasso = null;
    this._paint = null;
    this._toolMouseActions = false;
    this._selection = new Set();     // selected triangles (cells of the surface) of the target segment
    this._selectionGeometryId = null;
    this._highlight = null;          // Group showing the selection: faces, edges, points
    this._display = null;            // what the highlight was drawn for (tool, paint view toggle)
    this._brush = null;              // Mesh: the Paint brush on the surface under the pointer
    this._confirming = false;
    this._pendingEdit = null;        // an edit shown for Apply / Cancel
    this._patchTint = null;          // Mesh tinting the pending edit's patches
    this._issues = null;             // LineSegments showing the target surface's open edges
    this._issuesShown = false;
    this._topology = null;           // { points, topology, promise } of the target's surface (triangleTopology)
    this._ghost = null;              // LineSegments: the edited region's original surface behind a preview
    this._previewMesh = null;        // { geometryId, mesh }: the edited surface shown in place of the real mesh
    this._selectionRevision = 0;     // bumped by Clear and interaction changes: invalidates in-flight selections
    this._labelmapRevision = 0;      // bumped by every foreign edit of the working labelmap
    this._interactionKey = null;     // the tool and whether it can select, as last applied
    this._highlightFrame = null;     // a highlight redraw scheduled for the next frame (paint strokes)
    this._smoothInFlight = false;    // a smooth preview recompute is running
    this._smoothDirty = false;       // the settings changed again while it ran
    this._health = null;             // { points, result } of the last surface diagnostics
    this._smoothRerun = null;        // timer: recompute the smooth shown for Apply / Cancel
    this._smoothRun = 0;             // invalidates a smooth recompute that was overtaken
    this._unsubscribers = [];
    this._generation = 0;             // bumped on unmount: invalidates pending deletes
  }

  // -----------------------------------------------------------------------------------------
  // Models

  _createModel({ geometryId, surface, segmentIndex }) {
    this._sources.set(geometryId, surface.points);
    const model = createSurfaceModel({
      geometryId, surface, color: this._segmentColor(segmentIndex), lightingModel: 'vtk',
    });
    // The bounds tree is built with the mesh, not on the first hover or lasso
    if (model.instance?.geometry) {
      ensureBoundsTree(model.instance.geometry);
    }
    return model;
  }

  _loadInitialModels() {
    if (this.state.initialModels || !this.props.surfaceReady) {
      return;
    }
    const surfaces = getCachedSurfaces(this.props.segmentationId);
    if (!surfaces.length) {
      return;
    }
    this.setState({ initialModels: surfaces.map(entry => this._createModel(entry)) });
  }

  reconcileGeometry({ keepSelection = false } = {}) {
    // Apply surface changes to the live scene: rebuild meshes whose surface points changed, add
    // new segments' surfaces, and remove surfaces that no longer exist. A surface that kept its
    // vertices (a smooth) keeps the selection on it, moved to the new positions.
    if (!this.api) {
      return;
    }

    const surfaces = getCachedSurfaces(this.props.segmentationId);
    const current = new Set(surfaces.map(({ geometryId }) => geometryId));
    // A preview never writes the cache, so a change to the surface it was made from is someone
    // else's (a slice edit or import rebuilding it): the preview no longer applies
    const previewed = this._pendingEdit?.geometryId;
    let previewStale = !!previewed && !current.has(previewed);

    surfaces.forEach(entry => {
      const { geometryId, surface } = entry;
      const mesh = this.api.getModelInstance(geometryId);

      if (geometryId === previewed && surface.points !== this._pendingEdit.before.points) {
        previewStale = true;
      }
      if (!mesh) {
        this.api.addModel(this._createModel(entry));
      } else if (this._sources.get(geometryId) !== surface.points) {
        const previous = mesh.geometry;
        const sameVertices = keepSelection && this._sources.get(geometryId)?.length === surface.points.length;
        mesh.geometry = surfaceToBufferGeometry(surface);
        releaseBoundsTree(previous);
        previous?.dispose();
        ensureBoundsTree(mesh.geometry);
        this._sources.set(geometryId, surface.points);
        if (geometryId === this._selectionGeometryId) {
          if (sameVertices) {
            this._updateHighlight(this.api.getModels().find(model => model.geometryId === geometryId));
          } else {
            this.clearSelection(); // the selected indices refer to the old surface
          }
        }
      }
    });

    this.api.getModels().forEach(model => {
      if (!current.has(model.geometryId)) {
        if (model.geometryId === this._selectionGeometryId) {
          this.clearSelection();
        }
        releaseBoundsTree(model.instance?.geometry);
        disposeSurfaceModel(this.api.removeModel(model.geometryId));
        this._sources.delete(model.geometryId);
      }
    });

    if (previewStale) {
      this._dropStalePreview();
    }
  }

  _onSurfaceChanged(options) {
    // A surface edit (or its undo) changed a cached surface: follow it
    this.reconcileGeometry({ keepSelection: !!options?.keepSelection });
    this.publishTarget();
    this._refreshSurfaceHealth();
  }

  // -----------------------------------------------------------------------------------------
  // Presentation

  _segmentColor(segmentIndex) {
    const { colorLUTIndex } = this.props;
    if (!_.isNumber(colorLUTIndex)) {
      return undefined;
    }
    const colorLUT = c3dSegmentations.state.getColorLUT(colorLUTIndex);
    return lutColorToCss(colorLUT?.[segmentIndex]);
  }

  _segmentVisible(segmentIndex) {
    const { referenceViewportId, segmentationId } = this.props;
    if (!referenceViewportId) {
      return true;
    }

    const specifier = { segmentationId, type: SurfaceRepresentation };
    const representations = c3dSegmentations.state.getSegmentationRepresentations(
      referenceViewportId, specifier);
    if (!representations?.length) {
      // Surface representation not on the VTK view (e.g. the Surface toggle is off): no
      // per-viewport visibility state to follow.
      return true;
    }

    return c3dSegmentations.config.visibility.getSegmentationRepresentationVisibility(
        referenceViewportId, specifier) !== false
      && c3dSegmentations.config.visibility.getSegmentIndexVisibility(
        referenceViewportId, specifier, segmentIndex) !== false;
  }

  _segmentLocked(segmentIndex) {
    // Lock state is kept on the working segmentation, the one the side panel edits
    const { editSegmentationId, segmentationId } = this.props;
    return c3dSegmentations.segmentLocking.isSegmentIndexLocked(
      editSegmentationId || segmentationId, segmentIndex);
  }

  syncPresentation() {
    // Reconcile every mesh against the segmentation state; safe to call repeatedly
    if (!this.api) {
      return;
    }

    this.api.getModels().forEach(({ geometryId, segmentIndex }) => {
      if (!_.isNumber(segmentIndex)) {
        return;
      }
      // While an edit of this surface is previewed, the preview mesh is shown in its place
      const visible = this._segmentVisible(segmentIndex);
      const previewing = this._previewMesh?.geometryId === geometryId;
      this.api.setModelVisibility(geometryId, visible && !previewing);
      if (previewing) {
        this._previewMesh.mesh.visible = visible;
      }
      this.api.setModelWireframe(geometryId, this._segmentLocked(segmentIndex));
      const color = this._segmentColor(segmentIndex);
      if (color) {
        this.api.setModelColor(geometryId, color);
      }
    });
  }

  // -----------------------------------------------------------------------------------------
  // Camera

  matchReferenceCamera() {
    // Take the VTK view's camera (on each show)
    const camera = vtkToViewCamera(this.props.getReferenceCamera?.());
    if (this.api && camera) {
      this.api.setCameraLookAt(camera);
    }
  }

  setViewOrientation(orientationId) {
    // Turn to a preset direction (extension-vtk viewOrientations) with the surfaces fitted to the view
    return applyViewOrientationToModelView(this.api, orientationId);
  }

  pushCameraToReference() {
    // Hand this view's camera back to the VTK view (on each hide)
    if (!this.api || !this.props.setReferenceCamera) {
      return;
    }
    const camera = viewToVtkCamera(this.api.getCameraLookAt(), this.props.getReferenceCamera?.());
    if (camera) {
      this.props.setReferenceCamera(camera);
    }
  }

  // -----------------------------------------------------------------------------------------
  // Events

  _onSegmentationModified(evt) {
    // Surface updates (updateSurfaceData ends with SEGMENTATION_MODIFIED), segments added or
    // removed; on the working segmentation: lock and active-segment changes
    const { segmentationId, editSegmentationId } = this.props;
    const modifiedId = evt?.detail?.segmentationId;

    if (modifiedId === segmentationId) {
      if (!this.state.initialModels) {
        this._loadInitialModels();
        return;
      }
      this.reconcileGeometry();
      this.syncPresentation();
      this.publishTarget();
    } else if (editSegmentationId && modifiedId === editSegmentationId) {
      this.syncPresentation();
      this.publishTarget();
    }
  }

  _onRepresentationModified(evt) {
    // Colour and visibility changes on the VTK view's representation
    const { segmentationId, viewportId } = evt?.detail || {};
    if (segmentationId && segmentationId !== this.props.segmentationId) {
      return;
    }
    if (viewportId && this.props.referenceViewportId && viewportId !== this.props.referenceViewportId) {
      return;
    }
    this.syncPresentation();
    this.publishTarget();
  }

  // -----------------------------------------------------------------------------------------
  // 3D tools

  _targetModel(segmentIndex) {
    return this.api?.getModels().find(model => model.segmentIndex === segmentIndex);
  }

  publishTarget() {
    // Publish the segment the 3D tools act on: the working segmentation's active segment, when
    // it can be edited here
    const { editSegmentationId, t } = this.props;
    if (!editSegmentationId || !this.api) {
      return;
    }

    const segmentIndex = c3dSegmentations.segmentIndex.getActiveSegmentIndex(editSegmentationId);
    const segment = c3dSegmentations.state.getSegmentation(editSegmentationId)?.segments?.[segmentIndex];
    const label = segment?.label;

    let disabledReason;
    if (!segmentIndex || !segment) {
      disabledReason = t('Select a segment to edit');
    } else if (this._segmentLocked(segmentIndex)) {
      disabledReason = t('The selected segment is locked');
    } else if (!this._segmentVisible(segmentIndex)) {
      disabledReason = t('The selected segment is hidden');
    } else if (!this._targetModel(segmentIndex)) {
      disabledReason = t('The selected segment has no 3D surface yet');
    }

    // The target's topology is built ahead of the first stroke
    if (!disabledReason) {
      this._topologyFor(this._targetModel(segmentIndex));
    }
    const color = segmentIndex ? this._segmentColor(segmentIndex) : undefined;
    const previous = get3DToolState().target;
    if (previous?.segmentIndex !== segmentIndex || disabledReason) {
      this.clearSelection();
    }
    if (previous?.segmentIndex !== segmentIndex || previous?.label !== label
        || previous?.disabledReason !== disabledReason || previous?.color !== color) {
      set3DToolTarget({ segmentIndex, label, color, disabledReason });
    }
    this._refreshSurfaceHealth();
  }

  _apply3DToolState(state = get3DToolState()) {
    // Hand the left mouse button to the Selection tool while it is active and can act; give it
    // back to the camera otherwise
    if (!this.api || !this._lasso) {
      return;
    }
    const tool = state.activeTool;
    const selecting = !!this.props.active && is3DSelectionTool(tool) && is3DTargetEditable(state);
    const painting = tool === THREE_D_TOOLS.Paint;
    const interactionKey = `${tool}|${selecting}`;
    if (interactionKey !== this._interactionKey) {
      // A lasso or stroke still waiting for the topology belongs to the interaction that started it
      this._interactionKey = interactionKey;
      this._selectionRevision += 1;
    }

    this._lasso.setShape?.(state.lassoShape);
    if (selecting) {
      (painting ? this._lasso : this._paint)?.disable();
      (painting ? this._paint : this._lasso)?.enable();
      if (!this._toolMouseActions) {
        this.api.setMouseActions(TOOL_MOUSE_ACTIONS);
        this._toolMouseActions = true;
      }
    } else {
      this._lasso.disable();
      this._paint?.disable();
      if (this._toolMouseActions) {
        this.api.setMouseActions(null);
        this._toolMouseActions = false;
      }
    }
    if (this._brush) {
      this._brush.scale.setScalar(state.paintRadius);
    }

    // The selection is kept between the two selection tools, and dropped with them
    if (!is3DSelectionTool(tool) && this._selection.size) {
      this.clearSelection();
    }

    // The selection is shown for the tool in use: points over a faint tint for the lasso, tinted
    // faces with subdued points and edges for the brush
    const display = tool;
    if (display !== this._display) {
      this._display = display;
      if (this._selection.size && state.target) {
        this._updateHighlight(this._targetModel(state.target.segmentIndex));
      }
    }

    if (!!state.showIssues !== this._issuesShown) {
      this._issuesShown = !!state.showIssues;
      this._refreshSurfaceHealth({ force: true });
    }

    // A smooth shown for Apply / Cancel follows its settings
    if (this._pendingEdit?.kind === 'smooth' && this._smoothOptionsChanged(state)) {
      this._scheduleSmoothRerun();
    }
  }

  // -----------------------------------------------------------------------------------------
  // Surface health (open and non-manifold edges of the target's surface)

  _targetSurface() {
    const { target } = get3DToolState();
    const model = target && this._targetModel(target.segmentIndex);
    const surface = model && c3dCache.getGeometry(model.geometryId)?.data;
    return surface?.points?.length ? { model, surface } : null;
  }

  _refreshSurfaceHealth({ force = false } = {}) {
    // Diagnose the target's surface in the worker (once per surface version), publish the counts,
    // and draw the edges while the overlay is on
    const found = this._targetSurface();
    if (!found) {
      this._health = null;
      this._removeIssuesOverlay();
      set3DSurfaceHealth(null);
      return;
    }
    const { model, surface } = found;
    if (this._health?.points === surface.points) {
      if (force && this._health.result) {
        this._updateIssuesOverlay(model, surface, this._health.result);
      }
      return;
    }
    const entry = { points: surface.points, result: null };
    this._health = entry;
    const generation = this._generation;
    Promise.resolve()
      .then(() => diagnoseSurfaceInWorker(surface, { weldTolerance: get3DToolState().weldTolerance }))
      .then(result => {
        if (!this._isMounted || this._generation !== generation || this._health !== entry) {
          return;
        }
        entry.result = result;
        set3DSurfaceHealth({
          boundaryEdgeCount: result.boundaryEdgeCount,
          nonManifoldEdgeCount: result.nonManifoldEdgeCount,
          degenerate: result.degenerate || 0,
          duplicate: result.duplicate || 0,
          closed: result.closed,
          triangles: Math.floor(surface.polys.length / 4),
        });
        this._updateIssuesOverlay(model, surface, result);
      })
      .catch(err => {
        console.error('[SegEditorSurfaceView] surface diagnostics failed', err);
      });
  }

  _updateIssuesOverlay(model, surface, result) {
    this._removeIssuesOverlay();
    if (!this._issuesShown || !this.api?.scene || !model?.instance) {
      return;
    }
    const segments = [];
    const colors = [];
    const push = (edges, color) => {
      const rgb = [((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
      for (let e = 0; e < edges.length; e += 2) {
        [edges[e], edges[e + 1]].forEach(v => {
          segments.push(surface.points[3 * v], surface.points[3 * v + 1], surface.points[3 * v + 2]);
          colors.push(...rgb);
        });
      }
    };
    push(result.boundaryEdges || [], OPEN_EDGE_COLOR);
    push(result.nonManifoldEdges || [], NON_MANIFOLD_EDGE_COLOR);
    if (!segments.length) {
      return;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(segments), 3));
    geometry.setAttribute('color', new BufferAttribute(Float32Array.from(colors), 3));
    const material = new LineBasicMaterial({ vertexColors: true, depthTest: false });
    this._issues = new LineSegments(geometry, material);
    this._issues.renderOrder = 2;
    this._issues.matrixAutoUpdate = false;
    this._issues.matrix.copy(model.instance.matrixWorld);
    this.api.scene.add(this._issues);
  }

  _removeIssuesOverlay() {
    if (this._issues) {
      this._issues.parent?.remove(this._issues);
      this._issues.geometry.dispose();
      this._issues.material.dispose();
      this._issues = null;
    }
  }

  async selectWithLasso(lasso, mode) {
    const { target } = get3DToolState();
    const model = target && this._targetModel(target.segmentIndex);
    if (!model?.instance || !this.api) {
      return;
    }

    // Every visible mesh can hide faces of the target
    const occluders = this.api.getModels()
      .map(({ instance }) => instance)
      .filter(instance => instance?.visible);

    const lassoed = selectTrianglesInLasso({
      mesh: model.instance, camera: this.api.getCamera(), lasso, occluders,
    });
    let topology = null;
    if (get3DToolState().connectedOnly) {
      // Waits for the topology; Clear, a tool change or a new surface meanwhile drops this lasso,
      // and the selection is read only after the wait, so lassos and strokes apply in order
      const revision = this._selectionRevision;
      const points = this._sources.get(model.geometryId);
      topology = await this._topologyReady(model);
      if (!topology || !this._selectionStillCurrent(revision, model, points)) {
        return;
      }
    }
    const current = this._selectionGeometryId === model.geometryId ? this._selection : new Set();
    let selection = combineSelection(current, lassoed, mode);
    if (topology && selection.size) {
      selection = largestConnectedTriangles(selection, topology);
    }
    this._setSelection(model, selection);
  }

  _selectionStillCurrent(revision, model, points) {
    // An in-flight selection still applies: no Clear or interaction change since it started, and
    // the same surface of the same target
    return this._isMounted
      && revision === this._selectionRevision
      && this._sources.get(model.geometryId) === points
      && get3DToolState().target?.segmentIndex === model.segmentIndex;
  }

  _brushHit(ndc) {
    // The surface under the pointer, when it is the target's: the stroke will paint there, and
    // the brush is shown there
    const { target } = get3DToolState();
    const model = target && this._targetModel(target.segmentIndex);
    if (!model?.instance || !this.api) {
      this._hideBrush();
      return null;
    }
    const visible = this.api.getModels()
      .map(({ instance }) => instance)
      .filter(instance => instance?.visible);
    const hit = raycastSurfaces({ camera: this.api.getCamera(), ndc, objects: visible });
    if (!hit || hit.object !== model.instance) {
      this._hideBrush();
      return null;
    }
    this._showBrush(model, hit.point);
    return { model, hit };
  }

  async selectWithBrush(ndc, { erase = false } = {}) {
    // Paint (§13): the brush is a sphere on the surface under the pointer; the stroke selects
    // (or erases) the target's triangles it covers that are connected to the one it hit
    const found = this._brushHit(ndc);
    if (!found) {
      return;
    }
    const { model, hit } = found;
    const revision = this._selectionRevision;
    const points = this._sources.get(model.geometryId);
    const topology = await this._topologyReady(model);
    if (!topology || !this._selectionStillCurrent(revision, model, points)) {
      return;
    }
    const state = get3DToolState();
    const center = model.instance.worldToLocal(hit.point.clone());
    const collected = collectTrianglesInSphere({
      geometry: model.instance.geometry,
      center: [center.x, center.y, center.z],
      radius: state.paintRadius,
    });
    const painted = connectedTriangles({ collected, seed: hit.faceIndex, topology });
    const erasing = erase || state.paintMode === PAINT_MODES.erase;
    const current = this._selectionGeometryId === model.geometryId ? this._selection : new Set();
    // The highlight is redrawn once per frame during a stroke, and the regions are counted once,
    // when the stroke ends
    this._setSelection(model,
      combineSelection(current, painted, erasing ? SELECTION_MODES.subtract : SELECTION_MODES.add),
      { countRegions: false, defer: true });
  }

  _onStrokeEnd() {
    const { target } = get3DToolState();
    const model = target && this._targetModel(target.segmentIndex);
    if (model && this._selectionGeometryId === model.geometryId) {
      this._setSelection(model, this._selection);
    }
  }

  _showBrush(model, point) {
    if (!this.api?.scene) {
      return;
    }
    const tint = selectionTint(this._segmentColor(model.segmentIndex), FACE_TINT_TOWARD_WHITE);
    if (!this._brush) {
      const material = new MeshBasicMaterial({
        color: tint, transparent: true, opacity: 0.35, depthTest: false,
      });
      this._brush = new Mesh(new SphereGeometry(1, 24, 16), material);
      this._brush.renderOrder = 3;
      this.api.scene.add(this._brush);
    } else {
      this._brush.material.color.copy(tint);
    }
    this._brush.position.copy(point);
    this._brush.scale.setScalar(get3DToolState().paintRadius);
    this._brush.visible = true;
  }

  _hideBrush() {
    if (this._brush) {
      this._brush.visible = false;
    }
  }

  _removeBrush() {
    if (this._brush) {
      this._brush.parent?.remove(this._brush);
      this._brush.geometry.dispose();
      this._brush.material.dispose();
      this._brush = null;
    }
  }

  _topologyFor(model) {
    // Triangle topology of the target's surface, built off the main thread and kept while the
    // surface's points stay the same: the topology when it is ready, else null (a build starts)
    const surface = c3dCache.getGeometry(model.geometryId)?.data;
    if (!surface) {
      return null;
    }
    if (this._topology?.points === surface.points) {
      return this._topology.topology;
    }
    this._ensureTopology(model, surface);
    return null;
  }

  _ensureTopology(model, surface) {
    if (this._topology?.points === surface.points) {
      return this._topology.promise;
    }
    const entry = { points: surface.points, topology: null, promise: null };
    this._topology = entry;
    entry.promise = Promise.resolve()
      .then(() => this.props.computeTopology({ points: surface.points, polys: surface.polys }))
      .then(topology => {
        if (this._topology !== entry) {
          return null;
        }
        entry.topology = topology;
        // A selection made before the topology was ready gets its region count now
        if (this._isMounted && this._selection.size && this._selectionGeometryId === model.geometryId) {
          this._publishSelection(model);
        }
        return topology;
      })
      .catch(err => {
        if (this._topology === entry) {
          this._topology = null;
        }
        console.error('[SegEditorSurfaceView] surface topology failed', err);
        return null;
      });
    return entry.promise;
  }

  _topologyReady(model) {
    // The target's topology, awaited while it is built
    const surface = c3dCache.getGeometry(model.geometryId)?.data;
    if (!surface) {
      return Promise.resolve(null);
    }
    const ready = this._topologyFor(model);
    return ready ? Promise.resolve(ready) : this._ensureTopology(model, surface);
  }

  async reshapeSelection(kind) {
    // Grow the selection by one ring of triangles, or shrink it by its edge triangles
    const { target } = get3DToolState();
    const model = target && this._targetModel(target.segmentIndex);
    if (!model || !this._selection.size || this._selectionGeometryId !== model.geometryId) {
      return false;
    }
    const revision = this._selectionRevision;
    const points = this._sources.get(model.geometryId);
    const topology = await this._topologyReady(model);
    if (!topology || !this._selectionStillCurrent(revision, model, points)
        || this._selectionGeometryId !== model.geometryId) {
      return false;
    }
    const next = kind === 'grow'
      ? growTriangles(this._selection, topology)
      : shrinkTriangles(this._selection, topology);
    this._setSelection(model, next);
    return true;
  }

  _setSelection(model, selection, { countRegions = true, defer = false } = {}) {
    this._selection = selection;
    this._selectionGeometryId = selection.size ? model.geometryId : null;
    if (defer && typeof requestAnimationFrame === 'function') {
      if (this._highlightFrame === null) {
        this._highlightFrame = requestAnimationFrame(() => {
          this._highlightFrame = null;
          if (this._isMounted) {
            this._updateHighlight(model);
          }
        });
      }
    } else {
      this._cancelHighlightFrame();
      this._updateHighlight(model);
    }
    this._publishSelection(model, { countRegions });
  }

  _cancelHighlightFrame() {
    if (this._highlightFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._highlightFrame);
    }
    this._highlightFrame = null;
  }

  _publishSelection(model, { countRegions = true } = {}) {
    const selection = this._selection;
    const polys = c3dCache.getGeometry(model.geometryId)?.data?.polys;
    const topology = countRegions && selection.size ? this._topologyFor(model) : null;
    set3DSelectionCount(selection.size, {
      points: polys && selection.size ? trianglesVertices(selection, polys).size : 0,
      regions: topology ? triangleComponents(selection, topology).length : (selection.size ? 1 : 0),
    });
  }

  clearSelection() {
    this._cancelHighlightFrame();
    this._selectionRevision += 1;
    if (!this._selection.size && !this._highlight) {
      return;
    }
    this._selection = new Set();
    this._selectionGeometryId = null;
    this._updateHighlight(null);
    set3DSelectionCount(0);
  }

  _removeHighlight() {
    if (!this._highlight) {
      return;
    }
    this._highlight.parent?.remove(this._highlight);
    this._highlight.children.forEach(child => {
      child.geometry.dispose();
      child.material.dispose();
    });
    this._highlight = null;
  }

  _updateHighlight(model) {
    // The selection over the target's mesh, in its own geometry (the selected triangles' vertices,
    // compacted): the faces tinted, their edges, and their points. The lasso shows near-white
    // points and edges over a faint tint; the brush shows the tint, with subdued points and edges
    // so the topology stays readable.
    this._removeHighlight();
    const polys = model && c3dCache.getGeometry(model.geometryId)?.data?.polys;
    if (!model?.instance || !polys || !this._selection.size || !this.api?.scene) {
      return;
    }
    const painting = get3DToolState().activeTool === THREE_D_TOOLS.Paint;
    const color = this._segmentColor(model.segmentIndex);
    const faceTint = selectionTint(color, FACE_TINT_TOWARD_WHITE);
    const edgeTint = painting ? faceTint : selectionTint(color, LASSO_EDGE_TINT_TOWARD_WHITE);
    const pointTint = selectionTint(color, painting ? PAINT_POINT_TINT_TOWARD_WHITE : LASSO_POINT_TINT_TOWARD_WHITE);

    // A smooth's selection is drawn on the previewed positions while its preview is shown
    const shown = this._previewMesh?.geometryId === model.geometryId ? this._previewMesh.mesh : model.instance;
    const source = shown.geometry.getAttribute('position');
    const local = new Map();
    const positions = [];
    const faceIndex = [];
    const edgeIndex = [];
    const at = v => {
      let index = local.get(v);
      if (index === undefined) {
        index = local.size;
        local.set(v, index);
        positions.push(source.getX(v), source.getY(v), source.getZ(v));
      }
      return index;
    };
    this._selection.forEach(t => {
      const a = at(polys[4 * t + 1]);
      const b = at(polys[4 * t + 2]);
      const c = at(polys[4 * t + 3]);
      faceIndex.push(a, b, c);
      edgeIndex.push(a, b, b, c, c, a);
    });
    const position = new BufferAttribute(Float32Array.from(positions), 3);

    const group = new Group();
    group.renderOrder = 1;
    group.matrixAutoUpdate = false;
    group.matrix.copy(model.instance.matrixWorld);

    const faces = new BufferGeometry();
    faces.setAttribute('position', position);
    faces.setIndex(new BufferAttribute(Uint32Array.from(faceIndex), 1));
    group.add(new Mesh(faces, new MeshBasicMaterial({
      color: faceTint, transparent: true, opacity: painting ? 0.6 : 0.2, side: DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    })));

    const edges = new BufferGeometry();
    edges.setAttribute('position', position);
    edges.setIndex(new BufferAttribute(Uint32Array.from(edgeIndex), 1));
    group.add(new LineSegments(edges, new LineBasicMaterial({
      color: edgeTint, transparent: true, opacity: painting ? 0.5 : 0.7, depthTest: false,
    })));

    const points = new BufferGeometry();
    points.setAttribute('position', position);
    group.add(new Points(points, new PointsMaterial({
      color: pointTint, size: painting ? 2 : 4, sizeAttenuation: false, depthTest: false,
    })));

    this._highlight = group;
    this.api.scene.add(group);
  }

  /**
   * One flow for every edit of the target's surface (Remove, Smooth, Repair): the guards, the
   * target checks before and after the computation, the busy latch and step overlay, the preview
   * or commit, and the failure report. `compute` returns the edit (its `after`, `editBox`,
   * `write`, and what the summary needs), null when there was nothing to do (it has told the
   * user), or false when it refused (likewise).
   */
  async _runSurfaceEdit({
    title, cancelledMessage, step, needsSelection = true, confirmFirst = null, compute,
  }) {
    const { editSegmentationId, notify, t } = this.props;
    const state = get3DToolState();
    const { target } = state;
    const model = target && this._targetModel(target.segmentIndex);
    if (this._confirming || state.busy || !is3DTargetEditable(state) || !model || !editSegmentationId || !this.api) {
      return false;
    }
    if (needsSelection && (!this._selection.size || model.geometryId !== this._selectionGeometryId)) {
      return false;
    }

    if (confirmFirst) {
      this._confirming = true;
      let confirmed = false;
      try {
        confirmed = await confirmFirst({ model, state });
      } finally {
        this._confirming = false;
      }
      if (!confirmed || !this.api) {
        return false;
      }
    }

    // The selection must still refer to the surface the mesh was built from
    const surface = c3dCache.getGeometry(model.geometryId)?.data;
    const labelmap = getLabelmapForEdit(editSegmentationId);
    if (!surface || this._sources.get(model.geometryId) !== surface.points || !labelmap) {
      if (needsSelection) {
        this.clearSelection();
        notify?.({
          type: 'warning',
          title,
          message: t('The segment changed while the faces were selected. Select them again.'),
        });
      }
      return false;
    }

    const selected = Array.from(this._selection);
    const { segmentIndex } = target;
    const before = { points: surface.points, polys: surface.polys };
    // The computation awaits workers. The edit is applied only if, at that moment, this view is
    // still the one that started it, the surface is the one it was computed from, and the target
    // is still unlocked and edited in the same labelmap volume.
    const generation = this._generation;
    // A foreign edit of the working labelmap during the computation makes its input stale even
    // before the surface is rebuilt from it (the rebuild is debounced)
    const labelmapRevision = this._labelmapRevision;
    const validity = this._validityCheck(editSegmentationId, segmentIndex, labelmap.volume);
    const stillValid = () => validity() && this._labelmapRevision === labelmapRevision;

    const job = begin3DToolJob();
    this._toolBeforeEdit = state.activeTool;
    this.setState({ deleteStep: step });
    try {
      const edit = await compute({
        model, surface, before, selected, segmentIndex, state, stillValid,
        onStep: next => this._isMounted && this.setState({ deleteStep: next }),
      });
      if (!stillValid() || this._sources.get(model.geometryId) !== surface.points) {
        throw new SurfaceEditCancelledError();
      }
      if (edit === null) {
        return true;
      }
      if (edit === false) {
        return false;
      }
      if (!edit.keepSelection) {
        this.clearSelection();
      }
      const full = {
        ...edit, geometryId: model.geometryId, segmentIndex, before, labelmapVolume: labelmap.volume, stillValid,
      };
      if (edit.previewAlways || state.previewEnabled) {
        this._startPreview(model, full);
      } else {
        this._commitEdit(full);
      }
      return true;
    } catch (err) {
      this._reportEditFailure(err, generation, title, cancelledMessage);
      return false;
    } finally {
      end3DToolJob(job);
      if (this._isMounted) {
        this.setState({ deleteStep: null });
      }
    }
  }

  _cutDeps(stillValid) {
    // The whole-mesh stages run in the carve worker, the patches in the hole-filling worker
    return {
      prepareCut: args => prepareCutInWorker(args),
      prepareRepair: args => prepareRepairInWorker(args),
      assembleCut: args => assembleCutInWorker(args),
      patchHoles: (loops, options) => patchHolesInWorker(loops, options),
      isCancelled: () => !stillValid(),
    };
  }

  deleteSelectedPoints() {
    // Delete (FR-19..FR-22, §12): confirm (or preview), then remove the faces from the segment
    // and its labelmap
    const { confirm, notify, t } = this.props;
    const title = t('Remove selected faces');
    return this._runSurfaceEdit({
      title,
      cancelledMessage: t('The segment changed while the faces were being removed, so nothing was removed.'),
      step: DELETE_STEPS.cut,
      // With the preview on, the edit itself is the confirmation (Apply / Cancel)
      confirmFirst: ({ state }) => (confirm && !state.previewEnabled ? confirm({
        title,
        message: t('Remove {{faces}} selected faces from "{{segment}}"? The surface is closed where they were, and the segment\'s voxels outside it are removed.', {
          faces: this._selection.size,
          segment: state.target.label || t('Segment {{index}}', { index: state.target.segmentIndex }),
        }),
        confirmText: t('Remove'),
        cancelText: t('Cancel'),
      }) : true),
      compute: async ({ before, selected, state, stillValid, onStep }) => {
        const cut = await cutAndPatch({
          surface: before,
          selectedTriangles: selected,
          options: get3DEditOptions(),
          deps: this._cutDeps(stillValid),
          onStep,
        });
        if (!cut.changed) {
          this.clearSelection();
          notify?.({
            type: 'info',
            title,
            message: t('The selected faces are not part of the surface, so nothing was removed.'),
          });
          return null;
        }
        const depth = state.removalDepth;
        return {
          selected,
          after: cut.edited || EMPTY_SURFACE,
          editBox: cut.editBox,
          selectedPoints: cut.selectedPoints,
          depth,
          write: { kind: WRITE_KINDS.delete, selectedPoints: cut.selectedPoints, depth },
          cut,
          repair: false,
        };
      },
    });
  }

  smoothSelection() {
    // Smooth (ohif-viewers#148, FR-1..FR-10): the selected region is evened out with its edge
    // pinned (or eased) and shown for Apply / Cancel; the labelmap follows the moved surface once
    // applied
    const { notify, t } = this.props;
    const title = t('Smooth selected faces');
    return this._runSurfaceEdit({
      title,
      cancelledMessage: t('The segment changed while the faces were being smoothed, so nothing was changed.'),
      step: DELETE_STEPS.smooth,
      compute: async ({ before, selected }) => {
        const options = get3DSmoothOptions();
        const result = await smoothInWorker({ surface: before, selectedTriangles: selected, options });
        if (!result.changed) {
          notify?.({
            type: 'info',
            title,
            message: t('Select a region with an interior to smooth: the edge of the selection is pinned.'),
          });
          return null;
        }
        if (result.flipped || result.degenerate) {
          notify?.({
            type: 'warning',
            title,
            message: t('The smoothing would fold the surface over itself. Lower the strength or the passes.'),
          });
          return false;
        }
        return {
          kind: 'smooth',
          selected,
          after: result.after,
          editBox: result.editBox,
          write: { kind: WRITE_KINDS.smooth },
          keepSelection: true,
          previewAlways: true,
          moved: result.moved,
          options,
        };
      },
    });
  }

  repairSurface() {
    // Close the open rims of the target's surface (nothing is written to the labelmap)
    const { notify, t } = this.props;
    const title = t('Repair surface');
    return this._runSurfaceEdit({
      title,
      cancelledMessage: t('The surface could not be repaired. It is unchanged.'),
      step: DELETE_STEPS.patch,
      needsSelection: false,
      compute: async ({ before, stillValid, onStep }) => {
        const cut = await repairSurface({
          surface: before,
          options: get3DEditOptions(),
          deps: this._cutDeps(stillValid),
          onStep,
        });
        if (!cut.changed) {
          notify?.({ type: 'info', title, message: t('The surface has no open rims to close.') });
          return null;
        }
        return {
          after: cut.edited,
          editBox: cut.editBox,
          selectedPoints: cut.selectedPoints,
          depth: 0,
          write: { kind: WRITE_KINDS.delete, selectedPoints: cut.selectedPoints, depth: 0 },
          cut,
          repair: true,
        };
      },
    });
  }

  _smoothOptionsChanged(state) {
    const options = this._pendingEdit?.options;
    return !!options && (options.strength !== state.smoothStrength
      || options.passes !== state.smoothPasses || options.feather !== state.smoothFeather);
  }

  _scheduleSmoothRerun() {
    clearTimeout(this._smoothRerun);
    this._smoothRerun = setTimeout(() => {
      this._smoothRerun = null;
      this._rerunSmoothPreview();
    }, SMOOTH_RERUN_DELAY_MS);
  }

  async _rerunSmoothPreview() {
    // The smooth shown for Apply / Cancel, recomputed with the current settings. One recompute
    // runs at a time: settings changed while it runs are taken up once, when it is done, so the
    // worker never works on a request already superseded. A result that would fold the surface
    // leaves the one shown in place.
    const edit = this._pendingEdit;
    if (!edit || edit.kind !== 'smooth' || !this.api) {
      return;
    }
    if (this._smoothInFlight) {
      this._smoothDirty = true;
      return;
    }
    const { notify, onEditError, t } = this.props;
    if (!this._previewIsCurrent(edit)) {
      this._dropStalePreview();
      return;
    }
    const options = get3DSmoothOptions();
    edit.options = options;
    this._smoothRun += 1;
    const run = this._smoothRun;
    this._smoothInFlight = true;
    this._smoothDirty = false;
    try {
      const result = await smoothInWorker({ surface: edit.before, selectedTriangles: edit.selected, options });
      if (run !== this._smoothRun || this._pendingEdit !== edit || !this._isMounted) {
        return;
      }
      if (!result.changed || result.flipped || result.degenerate) {
        notify?.({
          type: 'warning',
          title: t('Smooth selected faces'),
          message: t('The smoothing would fold the surface over itself. Lower the strength or the passes.'),
        });
        return;
      }
      if (!this._previewIsCurrent(edit)) {
        this._dropStalePreview();
        return;
      }
      edit.after = result.after;
      edit.editBox = result.editBox;
      edit.moved = result.moved;
      // The recompute updates the preview mesh only; the cache is written on Apply
      this._updatePreviewMesh(edit.after);
      const model = this._targetModel(edit.segmentIndex);
      if (model && this._selectionGeometryId === model.geometryId) {
        this._updateHighlight(model);
      }
      set3DPreview(this._editSummary(edit));
    } catch (err) {
      if (this._isMounted && this._pendingEdit === edit) {
        onEditError?.(err);
      }
    } finally {
      this._smoothInFlight = false;
      if (this._smoothDirty && this._pendingEdit === edit && this._isMounted) {
        this._smoothDirty = false;
        this._rerunSmoothPreview();
      }
    }
  }

  _validityCheck(editSegmentationId, segmentIndex, labelmapVolume) {
    const generation = this._generation;
    return () => this._isMounted && this._generation === generation
      && !!c3dSegmentations.state.getSegmentation(editSegmentationId)?.segments?.[segmentIndex]
      && !this._segmentLocked(segmentIndex)
      && getLabelmapForEdit(editSegmentationId)?.volume === labelmapVolume;
  }

  _reportEditFailure(err, generation, title, cancelledMessage) {
    const { notify, onEditError } = this.props;
    if (err instanceof SurfaceEditCancelledError) {
      // Nothing was changed. Say so only while the same editor session is still open (the
      // segment was locked or removed meanwhile); a closed editor has nobody to tell.
      if (this._isMounted && this._generation === generation) {
        notify?.({ type: 'warning', title, message: cancelledMessage });
      }
    } else if (this._isMounted && this._generation === generation) {
      onEditError?.(err);
    }
  }

  // -----------------------------------------------------------------------------------------
  // Edits: preview, apply, cancel, repair

  _editSummary(edit) {
    if (edit.kind === 'smooth') {
      return { kind: 'smooth', points: edit.moved };
    }
    const { diagnostics = {}, holes = 0 } = edit.cut;
    return {
      points: edit.selectedPoints ? edit.selectedPoints.length / 3 : 0,
      holes,
      methods: diagnostics.methods || {},
      closed: diagnostics.output?.closed,
      openEdges: diagnostics.openEdges || 0,
      repair: !!edit.repair,
    };
  }

  _startPreview(model, edit) {
    // Show the edited surface on the canvas only (ohif-viewers#148 FR-2, §5.2): a preview mesh in
    // place of the real one, the new patches tinted and the original faces ghosted behind it. The
    // cached surface, the VTK view, the labelmap and the history are untouched until Apply
    // (Enter); Cancel (Escape) just takes the preview away.
    this._pendingEdit = edit;
    this._showPreviewMesh(model, edit.after);
    if (edit.cut) {
      this._showPatchTint(model, edit.after);
    }
    this._showGhost(model, edit);
    if (edit.keepSelection && this._selectionGeometryId === model.geometryId) {
      this._updateHighlight(model);
    }
    set3DPreview(this._editSummary(edit));
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onPreviewKey);
    }
  }

  _endPreview() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onPreviewKey);
    }
    clearTimeout(this._smoothRerun);
    this._smoothRerun = null;
    this._smoothRun += 1;
    this._smoothDirty = false;
    this._removePatchTint();
    this._removeGhost();
    this._removePreviewMesh();
    const edit = this._pendingEdit;
    this._pendingEdit = null;
    // The real mesh comes back, and a kept selection is drawn on it again
    this.syncPresentation();
    const model = edit && this._targetModel(edit.segmentIndex);
    if (model && this._selectionGeometryId === model.geometryId) {
      this._updateHighlight(model);
    }
    set3DPreview(null);
    this._restoreTool();
  }

  _showPreviewMesh(model, surface) {
    this._removePreviewMesh();
    if (!this.api?.scene || !model?.instance) {
      return;
    }
    const material = model.instance.material?.clone
      ? model.instance.material.clone()
      : new MeshBasicMaterial({ color: this._segmentColor(model.segmentIndex) || FALLBACK_SEGMENT_COLOR });
    const mesh = new Mesh(surfaceToBufferGeometry(surface), material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(model.instance.matrixWorld);
    this._previewMesh = { geometryId: model.geometryId, mesh };
    this.api.scene.add(mesh);
    this.syncPresentation();
  }

  _updatePreviewMesh(surface) {
    const preview = this._previewMesh;
    if (!preview) {
      return;
    }
    const previous = preview.mesh.geometry;
    preview.mesh.geometry = surfaceToBufferGeometry(surface);
    previous?.dispose?.();
  }

  _removePreviewMesh() {
    const preview = this._previewMesh;
    if (!preview) {
      return;
    }
    this._previewMesh = null;
    preview.mesh.parent?.remove(preview.mesh);
    preview.mesh.geometry?.dispose?.();
    preview.mesh.material?.dispose?.();
  }

  _previewIsCurrent(edit) {
    // The preview still applies: the cached surface is the one it was made from, nothing else
    // has edited the working labelmap since, and the target is still editable in the same volume
    return !edit.stale
      && c3dCache.getGeometry(edit.geometryId)?.data?.points === edit.before.points
      && (!edit.stillValid || edit.stillValid());
  }

  _dropStalePreview() {
    // The segment changed under a preview: take it away without writing anything, and say so
    const edit = this._pendingEdit;
    if (!edit) {
      return;
    }
    edit.stale = true;
    this._endPreview();
    const { notify, t } = this.props;
    if (this._isMounted) {
      notify?.({
        type: 'warning',
        title: edit.kind === 'smooth' ? t('Smooth selected faces')
          : edit.repair ? t('Repair surface') : t('Remove selected faces'),
        message: t('The segment changed while the edit was shown, so it was not applied. Make the edit again.'),
      });
    }
  }

  _onLabelmapModified = (evt) => {
    // A foreign edit of the working labelmap (a slice edit, an import): counted whether or not a
    // preview is shown, so a computation running when it lands is refused too (its stillValid
    // check compares the count); a preview shown now no longer applies
    if (isOwnSurfaceWrite() || evt?.detail?.segmentationId !== this.props.editSegmentationId) {
      return;
    }
    this._labelmapRevision += 1;
    const edit = this._pendingEdit;
    if (edit) {
      edit.stale = true;
      this._dropStalePreview();
    }
  };

  _showGhost(model, edit) {
    // The original surface of the edited region, as a faint wireframe behind the preview, so the
    // result can be compared with what it replaces (ohif-viewers#148, FR-2)
    this._removeGhost();
    const cells = edit.selected;
    if (!cells?.length || !this.api?.scene || !model?.instance) {
      return;
    }
    const { points, polys } = edit.before;
    const local = new Map();
    const positions = [];
    const edges = [];
    const at = v => {
      let index = local.get(v);
      if (index === undefined) {
        index = local.size;
        local.set(v, index);
        positions.push(points[3 * v], points[3 * v + 1], points[3 * v + 2]);
      }
      return index;
    };
    cells.forEach(t => {
      const a = at(polys[4 * t + 1]);
      const b = at(polys[4 * t + 2]);
      const c = at(polys[4 * t + 3]);
      edges.push(a, b, b, c, c, a);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(positions), 3));
    geometry.setIndex(new BufferAttribute(Uint32Array.from(edges), 1));
    const material = new LineBasicMaterial({ color: GHOST_COLOR, transparent: true, opacity: 0.35, depthTest: false });
    this._ghost = new LineSegments(geometry, material);
    this._ghost.renderOrder = 1;
    this._ghost.matrixAutoUpdate = false;
    this._ghost.matrix.copy(model.instance.matrixWorld);
    this.api.scene.add(this._ghost);
  }

  _removeGhost() {
    if (this._ghost) {
      this._ghost.parent?.remove(this._ghost);
      this._ghost.geometry.dispose();
      this._ghost.material.dispose();
      this._ghost = null;
    }
  }

  _abandonPreview() {
    // The preview never wrote anything, so taking it away is all there is to do
    if (this._pendingEdit) {
      this._endPreview();
    }
  }

  _restoreTool() {
    // The tool in use when the edit started stays in use after it (FR-37)
    const tool = this._toolBeforeEdit;
    this._toolBeforeEdit = null;
    if (tool && this._isMounted && get3DToolState().activeTool !== tool) {
      setActive3DTool(tool);
    }
  }

  _onPreviewKey = (event) => {
    const tag = event.target?.tagName;
    if (event.defaultPrevented || tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelPreview();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.applyPreview();
    }
  };

  applyPreview() {
    // Apply only what the preview was made from: a surface or labelmap changed meanwhile refuses it
    const edit = this._pendingEdit;
    if (!edit) {
      return false;
    }
    if (!this._previewIsCurrent(edit)) {
      this._dropStalePreview();
      return false;
    }
    this._endPreview();
    this._commitEdit(edit);
    return true;
  }

  cancelPreview() {
    // The surface goes back, and so does the selection the edit was made from, so the options
    // can be changed and the edit tried again without selecting the points anew
    const edit = this._pendingEdit;
    if (!edit) {
      return false;
    }
    this._endPreview();
    const model = edit.selected?.length ? this._targetModel(edit.segmentIndex) : null;
    if (model && model.geometryId === edit.geometryId
        && this._sources.get(edit.geometryId) === edit.before.points) {
      this._setSelection(model, new Set(edit.selected));
    }
    return true;
  }

  _commitEdit(edit) {
    // Record the edit in the shared history and apply it: the surface shown and, behind it, the
    // labelmap written (FR-23/FR-24): a removal clears the voxels the surface no longer contains,
    // a smooth moves the segment with the surface. A repair changes the surface only.
    const { notify, t } = this.props;
    const memo = createSurfaceEditMemo({
      geometryId: edit.geometryId,
      segmentIndex: edit.segmentIndex,
      before: edit.before,
      after: edit.after,
      editBox: edit.editBox,
      write: edit.write || { kind: WRITE_KINDS.delete, selectedPoints: edit.selectedPoints, depth: edit.depth },
      keepSelection: !!edit.keepSelection,
      labelmapVolume: edit.labelmapVolume,
      deps: {
        setSurface: (id, next, options) => setCachedSurface(this.props.segmentationId, id, next, options),
        queueWrite: pending => this._queueWrite(pending),
        withOwnEdit: this.props.withOwnLabelmapEdit,
      },
    });
    if (edit.repair) {
      memo.surfaceOnly = true;
    }
    recordSurfaceEdit(memo);
    set3DLastEdit(this._editSummary(edit));
    this._restoreTool();

    const { cut } = edit;
    if (cut?.cappedHoles) {
      notify?.({
        type: 'warning',
        title: edit.repair ? t('Repair surface') : t('Remove selected faces'),
        message: t('{{holes}} hole(s) could not be closed smoothly and were closed flat.', {
          holes: cut.cappedHoles,
        }),
      });
    }
  }

  _showPatchTint(model, after) {
    this._removePatchTint();
    const offset = after.patchPolysOffset;
    if (!this.api?.scene || !model?.instance || !(offset < after.polys.length)) {
      return;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(Float32Array.from(after.points), 3));
    geometry.setIndex(new BufferAttribute(polysToTriangles(after.polys.subarray(offset)), 1));
    const material = new MeshBasicMaterial({
      color: PATCH_TINT_COLOR, transparent: true, opacity: 0.6, depthTest: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this._patchTint = new Mesh(geometry, material);
    this._patchTint.renderOrder = 1;
    this._patchTint.matrixAutoUpdate = false;
    this._patchTint.matrix.copy(model.instance.matrixWorld);
    this.api.scene.add(this._patchTint);
  }

  _removePatchTint() {
    if (this._patchTint) {
      this._patchTint.parent?.remove(this._patchTint);
      this._patchTint.geometry.dispose();
      this._patchTint.material.dispose();
      this._patchTint = null;
    }
  }

  _queueWrite(memo) {
    // The labelmap write that follows a surface edit (and a redo's). The callbacks are the
    // layout's, so they outlive this canvas.
    const { editSegmentationId, notify, onEditError, withOwnLabelmapEdit, t } = this.props;
    const smooth = memo.write?.kind === WRITE_KINDS.smooth;
    return queueSurfaceEditWrite(memo, {
      editSegmentationId,
      withOwnEdit: withOwnLabelmapEdit,
      onRefused: () => notify?.({
        type: 'warning',
        title: smooth ? t('Smooth selected faces') : t('Remove selected faces'),
        message: smooth
          ? t('The segment changed before the 2D views could be updated. Undo the smoothing to restore the surface.')
          : t('The segment changed before the 2D views could be updated. Undo the removal to restore the surface.'),
      }),
      onError: error => onEditError?.(error),
    });
  }

  _createInteractions(api) {
    const shared = {
      element: api.renderer.domElement,
      overlayParent: api.container,
      onClear: () => {
        if (this._pendingEdit) {
          this.cancelPreview();
        } else if (!this._confirming) {
          this.clearSelection();
        }
      },
      onDelete: () => {
        this.deleteSelectedPoints();
      },
    };
    this._lasso = new LassoInteraction({
      ...shared,
      shape: get3DToolState().lassoShape,
      onLasso: (lasso, mode) => this.selectWithLasso(lasso, mode),
    });
    this._paint = new PaintInteraction({
      ...shared,
      onPaint: (ndc, options) => this.selectWithBrush(ndc, options),
      onHover: ndc => this._brushHit(ndc),
      onLeave: () => this._hideBrush(),
      onStrokeEnd: () => this._onStrokeEnd(),
    });
  }

  _onCreated(api) {
    this.api = api;
    api.resize();
    this.matchReferenceCamera();
    this.syncPresentation();
    api.setRenderingPaused(!this.props.active);
    this._createInteractions(api);
    this.publishTarget();
    this._apply3DToolState();
  }

  componentDidMount() {
    const { Events } = c3dToolsEnums;
    this._isMounted = true;
    c3dEventTarget.addEventListener(Events.SEGMENTATION_MODIFIED, this._onSegmentationModified);
    c3dEventTarget.addEventListener(
      Events.SEGMENTATION_REPRESENTATION_MODIFIED, this._onRepresentationModified);
    c3dEventTarget.addEventListener(Events.SEGMENTATION_DATA_MODIFIED, this._onLabelmapModified);
    this._unsubscribers.push(
      subscribe3DToolState(this._apply3DToolState),
      handle3DToolRequest('deleteSelection', () => this.deleteSelectedPoints()),
      handle3DToolRequest('smoothSelection', () => this.smoothSelection()),
      handle3DToolRequest('clearSelection', () => this.clearSelection()),
      handle3DToolRequest('growSelection', () => this.reshapeSelection('grow')),
      handle3DToolRequest('shrinkSelection', () => this.reshapeSelection('shrink')),
      handle3DToolRequest('applyPreview', () => this.applyPreview()),
      handle3DToolRequest('cancelPreview', () => this.cancelPreview()),
      handle3DToolRequest('repairSurface', () => this.repairSurface()),
      handle3DToolRequest(SURFACE_CHANGED_REQUEST, options => this._onSurfaceChanged(options)),
    );
    this._loadInitialModels();
  }

  componentDidUpdate(prevProps) {
    const { active, surfaceReady } = this.props;

    if (!prevProps.surfaceReady && surfaceReady) {
      this._loadInitialModels();
    }

    if (this.api && prevProps.active !== active) {
      if (active) {
        // The container was hidden: take up its current size, the VTK view's camera, and any
        // state change made meanwhile
        this.api.resize();
        this.matchReferenceCamera();
        this.reconcileGeometry();
        this.syncPresentation();
        this.publishTarget();
      } else {
        this.pushCameraToReference();
      }
      this.api.setRenderingPaused(!active);
      this._apply3DToolState();
    }
  }

  componentWillUnmount() {
    const { Events } = c3dToolsEnums;

    // Unmounted while shown (the layout was rebuilt): the VTK view takes this camera, and the
    // replacement canvas copies it back from there. A hidden canvas holds a stale camera and
    // hands nothing over.
    if (this.props.active) {
      this.pushCameraToReference();
    }

    this._generation += 1;
    clearTimeout(this._smoothRerun);
    this._smoothRerun = null;
    c3dEventTarget.removeEventListener(Events.SEGMENTATION_MODIFIED, this._onSegmentationModified);
    c3dEventTarget.removeEventListener(
      Events.SEGMENTATION_REPRESENTATION_MODIFIED, this._onRepresentationModified);
    c3dEventTarget.removeEventListener(Events.SEGMENTATION_DATA_MODIFIED, this._onLabelmapModified);
    this._isMounted = false;
    this._unsubscribers.forEach(unsubscribe => unsubscribe());
    this._unsubscribers = [];

    this._lasso?.dispose();
    this._lasso = null;
    this._paint?.dispose();
    this._paint = null;
    this._removeBrush();
    this.clearSelection();
    // An edit still shown for Apply / Cancel is cancelled with the canvas: the preview wrote
    // nothing, so its overlays and listener go and nothing enters the history. (The replacement
    // canvas starts clean; the user can make the edit again.)
    this._abandonPreview();
    this._removeIssuesOverlay();
    this._health = null;
    set3DPreview(null);
    set3DSurfaceHealth(null);
    set3DToolTarget(null);

    // M3DModelView releases its renderer; the meshes are owned here
    (this.api ? this.api.getModels() : this.state.initialModels || []).forEach(model => {
      releaseBoundsTree(model.instance?.geometry);
      disposeSurfaceModel(model);
    });
    this.api = null;
    this._sources.clear();
  }

  render() {
    const { initialModels } = this.state;
    const style = { width: '100%', height: '100%', position: 'relative' };

    // Status uses the editor's viewport loading indicator, as the 3D tab's "Rendering" status does
    if (!initialModels) {
      const { noSurfaceMessage } = this.props;
      return (
        <div style={style}>
          {noSurfaceMessage && <LoadingIndicator loadingMessage={noSurfaceMessage} />}
        </div>
      );
    }

    const { deleteStep } = this.state;
    return (
      <div style={style}>
        {deleteStep && DELETE_STEP_MESSAGES[deleteStep] && (
          <LoadingIndicator loadingMessage={this.props.t(DELETE_STEP_MESSAGES[deleteStep])} />
        )}
        <M3DModelView
          modelType={MIMETYPE_STL}
          projection="orthographic"
          lightingModel="vtk"
          rotation="trackball"
          observeResize
          models={initialModels}
          onCreated={this._onCreated}
          getStaticUrl={() => ''}
        />
      </div>
    );
  }
}
