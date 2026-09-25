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
// - 3D tools (ohif-viewers#142, §10.2): with the Selection tool active, a left-button lasso
//   selects the visible surface points of the active segment of the working segmentation (right
//   rotates, middle pans, the wheel zooms), and Delete removes them after confirmation: the
//   holes are patched, and the voxels the edited surface no longer contains are removed from the
//   working labelmap (deleteSelection). The surface sync then rebuilds the surface from the
//   labelmap, which updates the meshes here.
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
import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from 'three';

import {
  createSurfaceModel,
  disposeSurfaceModel,
  M3DModelView,
  MIMETYPE_STL,
  surfaceToBufferGeometry,
} from '@ohif/extension-viewerm3d';

import { LoadingIndicator } from '@ohif/extension-vtk';

import { ensureBoundsTree, releaseBoundsTree } from '../threejs/meshBvh';
import { DeleteCancelledError, deleteSelection, DELETE_STEPS } from '../threeDTools/deleteSelection';
import LassoInteraction from '../threeDTools/LassoInteraction';
import { combineSelection, selectVerticesInLasso } from '../threeDTools/lassoSelection';
import {
  getLabelmapForEdit,
  patchHolesInWorker,
  removeLabelmapVoxels,
  voxelizeSurfaceInWorker,
} from '../threeDTools/segmentEdits';
import {
  begin3DToolJob,
  end3DToolJob,
  get3DToolState,
  handle3DToolRequest,
  is3DTargetEditable,
  set3DSelectionCount,
  set3DToolTarget,
  subscribe3DToolState,
  THREE_D_TOOLS,
} from '../threeDTools/threeDToolState';


const SurfaceRepresentation = c3dToolsEnums.SegmentationRepresentations.Surface;

// Camera bindings while a 3D tool owns the left button
const TOOL_MOUSE_ACTIONS = { left: 'none', right: 'rotate', middle: 'pan', wheel: 'zoom' };

const HIGHLIGHT_COLOR = 0xffd600;

// After a delete, the step that waits for the surface rebuilt from the labelmap
const RENDER_STEP = 'render';

// Longest wait for that rebuild before the status is cleared anyway
export const SURFACE_UPDATE_TIMEOUT_MS = 60000;

// Progress messages for the delete overlay (the render step uses the renderingMessage prop)
const DELETE_STEP_MESSAGES = {
  [DELETE_STEPS.cut]: 'Removing the selected points...',
  [DELETE_STEPS.patch]: 'Closing the surface...',
  [DELETE_STEPS.voxelize]: 'Updating the segmentation...',
  [DELETE_STEPS.write]: 'Updating the segmentation...',
};

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
    // () => void: a delete changed the working labelmap; update the surface from it now
    onLabelmapEdited: PropTypes.func,
    // Status shown while the surface is rebuilt after a delete (the 3D tab's Rendering message)
    renderingMessage: PropTypes.string,
    // i18n (react-i18next `t`, SegmentationEditor namespace)
    t: PropTypes.func,
  };

  static defaultProps = {
    active: true,
    surfaceReady: false,
    noSurfaceMessage: 'The 3D surface is not available yet.',
    renderingMessage: 'Rendering ...',
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
    this._toolMouseActions = false;
    this._selection = new Set();     // selected vertex indices of the target segment's mesh
    this._selectionGeometryId = null;
    this._highlight = null;          // Points showing the selection
    this._confirming = false;
    this._unsubscribers = [];
    this._surfaceWaiters = new Map(); // geometryId -> resolve, waiting for a rebuilt surface
    this._generation = 0;             // bumped on unmount: invalidates pending deletes
  }

  // -----------------------------------------------------------------------------------------
  // Models

  _createModel({ geometryId, surface, segmentIndex }) {
    this._sources.set(geometryId, surface.points);
    return createSurfaceModel({
      geometryId, surface, color: this._segmentColor(segmentIndex), lightingModel: 'vtk',
    });
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

  reconcileGeometry() {
    // Apply surface changes to the live scene: rebuild meshes whose surface points changed, add
    // new segments' surfaces, and remove surfaces that no longer exist.
    if (!this.api) {
      return;
    }

    const surfaces = getCachedSurfaces(this.props.segmentationId);
    const current = new Set(surfaces.map(({ geometryId }) => geometryId));

    surfaces.forEach(entry => {
      const { geometryId, surface } = entry;
      const mesh = this.api.getModelInstance(geometryId);

      if (!mesh) {
        this.api.addModel(this._createModel(entry));
      } else if (this._sources.get(geometryId) !== surface.points) {
        const previous = mesh.geometry;
        mesh.geometry = surfaceToBufferGeometry(surface);
        releaseBoundsTree(previous);
        previous?.dispose();
        this._sources.set(geometryId, surface.points);
        if (geometryId === this._selectionGeometryId) {
          this.clearSelection(); // the selected indices refer to the old surface
        }
        this._surfaceUpdated(geometryId);
      }
    });

    this.api.getModels().forEach(model => {
      if (!current.has(model.geometryId)) {
        if (model.geometryId === this._selectionGeometryId) {
          this.clearSelection();
        }
        releaseBoundsTree(model.instance?.geometry);
        disposeSurfaceModel(this.api.removeModel(model.geometryId));
        this._surfaceUpdated(model.geometryId);
        this._sources.delete(model.geometryId);
      }
    });
  }

  _surfaceUpdated(geometryId) {
    this._surfaceWaiters.get(geometryId)?.();
  }

  waitForSurfaceUpdate(geometryId, timeoutMs = SURFACE_UPDATE_TIMEOUT_MS) {
    // Resolves once the mesh of `geometryId` is rebuilt or removed, or after the timeout
    return new Promise(resolve => {
      const timer = setTimeout(done, timeoutMs);
      const waiters = this._surfaceWaiters;
      function done() {
        clearTimeout(timer);
        if (waiters.get(geometryId) === done) {
          waiters.delete(geometryId);
        }
        resolve();
      }
      waiters.get(geometryId)?.();
      waiters.set(geometryId, done);
    });
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
      this.api.setModelVisibility(geometryId, this._segmentVisible(segmentIndex));
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

    const previous = get3DToolState().target;
    if (previous?.segmentIndex !== segmentIndex || disabledReason) {
      this.clearSelection();
    }
    if (previous?.segmentIndex !== segmentIndex || previous?.label !== label
        || previous?.disabledReason !== disabledReason) {
      set3DToolTarget({ segmentIndex, label, disabledReason });
    }
  }

  _apply3DToolState(state = get3DToolState()) {
    // Hand the left mouse button to the Selection tool while it is active and can act; give it
    // back to the camera otherwise
    if (!this.api || !this._lasso) {
      return;
    }
    const selecting = !!this.props.active
      && state.activeTool === THREE_D_TOOLS.Selection
      && is3DTargetEditable(state);

    if (selecting) {
      this._lasso.enable();
      if (!this._toolMouseActions) {
        this.api.setMouseActions(TOOL_MOUSE_ACTIONS);
        this._toolMouseActions = true;
      }
    } else {
      this._lasso.disable();
      if (this._toolMouseActions) {
        this.api.setMouseActions(null);
        this._toolMouseActions = false;
      }
    }

    if (state.activeTool !== THREE_D_TOOLS.Selection && this._selection.size) {
      this.clearSelection();
    }
  }

  selectWithLasso(lasso, mode) {
    const { target } = get3DToolState();
    const model = target && this._targetModel(target.segmentIndex);
    if (!model?.instance || !this.api) {
      return;
    }

    // Every visible mesh can hide points of the target
    const occluders = this.api.getModels()
      .map(({ instance }) => instance)
      .filter(instance => instance?.visible);
    occluders.forEach(instance => ensureBoundsTree(instance.geometry));

    const lassoed = selectVerticesInLasso({
      mesh: model.instance, camera: this.api.getCamera(), lasso, occluders,
    });
    const current = this._selectionGeometryId === model.geometryId ? this._selection : new Set();
    this._setSelection(model, combineSelection(current, lassoed, mode));
  }

  _setSelection(model, selection) {
    this._selection = selection;
    this._selectionGeometryId = selection.size ? model.geometryId : null;
    this._updateHighlight(model);
    set3DSelectionCount(selection.size);
  }

  clearSelection() {
    if (!this._selection.size && !this._highlight) {
      return;
    }
    this._selection = new Set();
    this._selectionGeometryId = null;
    this._updateHighlight(null);
    set3DSelectionCount(0);
  }

  _updateHighlight(model) {
    if (this._highlight) {
      this._highlight.parent?.remove(this._highlight);
      this._highlight.geometry.dispose();
      this._highlight.material.dispose();
      this._highlight = null;
    }
    if (!model || !this._selection.size || !this.api?.scene) {
      return;
    }

    const source = model.instance.geometry.getAttribute('position');
    const positions = new Float32Array(this._selection.size * 3);
    let i = 0;
    this._selection.forEach(v => {
      positions[i++] = source.getX(v);
      positions[i++] = source.getY(v);
      positions[i++] = source.getZ(v);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const material = new PointsMaterial({
      color: HIGHLIGHT_COLOR, size: 4, sizeAttenuation: false, depthTest: false,
    });
    this._highlight = new Points(geometry, material);
    this._highlight.renderOrder = 1;
    this._highlight.matrixAutoUpdate = false;
    this._highlight.matrix.copy(model.instance.matrixWorld);
    this.api.scene.add(this._highlight);
  }

  async deleteSelectedPoints() {
    // Delete (FR-19..FR-22): confirm, then remove the points from the segment and its labelmap
    const { editSegmentationId, confirm, notify, onEditError, t } = this.props;
    const state = get3DToolState();
    const { target } = state;
    const model = target && this._targetModel(target.segmentIndex);
    if (this._confirming || state.busy || !this._selection.size || !is3DTargetEditable(state)
        || !model || model.geometryId !== this._selectionGeometryId || !editSegmentationId) {
      return false;
    }

    const count = this._selection.size;
    const segmentName = target.label || t('Segment {{index}}', { index: target.segmentIndex });
    this._confirming = true;
    let confirmed = false;
    try {
      confirmed = confirm ? await confirm({
        title: t('Remove selected points'),
        message: t('Remove {{points}} selected points from "{{segment}}"? The surface is closed where the points were, and the segment\'s voxels outside it are removed.', {
          points: count, segment: segmentName,
        }),
        confirmText: t('Remove'),
        cancelText: t('Cancel'),
      }) : true;
    } finally {
      this._confirming = false;
    }
    if (!confirmed || !this.api) {
      return false;
    }

    // The selection must still refer to the surface the mesh was built from
    const surface = c3dCache.getGeometry(model.geometryId)?.data;
    const labelmap = getLabelmapForEdit(editSegmentationId);
    if (!surface || this._sources.get(model.geometryId) !== surface.points || !labelmap) {
      this.clearSelection();
      notify?.({
        type: 'warning',
        title: t('Remove selected points'),
        message: t('The segment changed while the points were selected. Select them again.'),
      });
      return false;
    }

    const selected = Array.from(this._selection);
    const { segmentIndex } = target;

    // Everything below awaits workers. The write is committed only if, at that moment, this view
    // is still the one that started the delete, and the target is still unlocked and edited in
    // the same labelmap volume.
    const generation = this._generation;
    const stillValid = () => this._isMounted && this._generation === generation
      && !!c3dSegmentations.state.getSegmentation(editSegmentationId)?.segments?.[segmentIndex]
      && !this._segmentLocked(segmentIndex)
      && getLabelmapForEdit(editSegmentationId)?.volume === labelmap.volume;

    const job = begin3DToolJob();
    this.setState({ deleteStep: DELETE_STEPS.cut });
    try {
      const result = await deleteSelection({
        surface,
        selected,
        segmentIndex,
        depth: state.removalDepth,
        labelmap,
        deps: {
          patchHoles: loops => patchHolesInWorker(loops),
          voxelize: voxelizeSurfaceInWorker,
          isCancelled: () => !stillValid(),
          removeVoxels: indices => {
            if (!stillValid()) {
              throw new DeleteCancelledError();
            }
            removeLabelmapVoxels({ segmentationId: editSegmentationId, volume: labelmap.volume, indices });
          },
        },
        onStep: step => this._isMounted && this.setState({ deleteStep: step }),
      });
      this.clearSelection();

      // The edit is complete once the surface has been rebuilt from the labelmap
      if (result.removedVoxels && this._isMounted) {
        this.setState({ deleteStep: RENDER_STEP });
        const updated = this.waitForSurfaceUpdate(model.geometryId);
        this.props.onLabelmapEdited?.();
        await updated;
      }

      if (!result.removedVoxels) {
        notify?.({
          type: 'info',
          title: t('Remove selected points'),
          message: t('No voxels of the segment were inside the removed part, so the segmentation is unchanged.'),
        });
      } else if (result.cappedHoles) {
        notify?.({
          type: 'warning',
          title: t('Remove selected points'),
          message: t('{{holes}} hole(s) could not be closed smoothly and were closed flat.', {
            holes: result.cappedHoles,
          }),
        });
      }
      return true;
    } catch (err) {
      if (err instanceof DeleteCancelledError) {
        // Nothing was written. Say so only while the same editor session is still open (the
        // segment was locked or removed meanwhile); a closed editor has nobody to tell.
        if (this._isMounted && this._generation === generation) {
          notify?.({
            type: 'warning',
            title: t('Remove selected points'),
            message: t('The segment changed while the points were being removed, so nothing was removed.'),
          });
        }
      } else if (this._isMounted && this._generation === generation) {
        onEditError?.(err);
      }
      return false;
    } finally {
      end3DToolJob(job);
      if (this._isMounted) {
        this.setState({ deleteStep: null });
      }
    }
  }

  _createLasso(api) {
    this._lasso = new LassoInteraction({
      element: api.renderer.domElement,
      overlayParent: api.container,
      onLasso: (lasso, mode) => this.selectWithLasso(lasso, mode),
      onClear: () => {
        if (!this._confirming) {
          this.clearSelection();
        }
      },
      onDelete: () => {
        this.deleteSelectedPoints();
      },
    });
  }

  _onCreated(api) {
    this.api = api;
    api.resize();
    this.matchReferenceCamera();
    this.syncPresentation();
    api.setRenderingPaused(!this.props.active);
    this._createLasso(api);
    this.publishTarget();
    this._apply3DToolState();
  }

  componentDidMount() {
    const { Events } = c3dToolsEnums;
    this._isMounted = true;
    c3dEventTarget.addEventListener(Events.SEGMENTATION_MODIFIED, this._onSegmentationModified);
    c3dEventTarget.addEventListener(
      Events.SEGMENTATION_REPRESENTATION_MODIFIED, this._onRepresentationModified);
    this._unsubscribers.push(
      subscribe3DToolState(this._apply3DToolState),
      handle3DToolRequest('deleteSelection', () => this.deleteSelectedPoints()),
      handle3DToolRequest('clearSelection', () => this.clearSelection()),
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
    this._generation += 1;
    c3dEventTarget.removeEventListener(Events.SEGMENTATION_MODIFIED, this._onSegmentationModified);
    c3dEventTarget.removeEventListener(
      Events.SEGMENTATION_REPRESENTATION_MODIFIED, this._onRepresentationModified);
    this._isMounted = false;
    this._unsubscribers.forEach(unsubscribe => unsubscribe());
    this._unsubscribers = [];

    [...this._surfaceWaiters.values()].forEach(done => done());
    this._lasso?.dispose();
    this._lasso = null;
    this.clearSelection();
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
        {deleteStep && (
          <LoadingIndicator loadingMessage={deleteStep === RENDER_STEP
            ? this.props.renderingMessage
            : this.props.t(DELETE_STEP_MESSAGES[deleteStep])} />
        )}
        <M3DModelView
          modelType={MIMETYPE_STL}
          projection="orthographic"
          lightingModel="vtk"
          observeResize
          models={initialModels}
          onCreated={this._onCreated}
          getStaticUrl={() => ''}
        />
      </div>
    );
  }
}
