import _ from 'lodash';

import {
  // Segmentations
  segmentation as c3dSegmentations,
} from '@cornerstonejs/tools';
import { SegmentationRepresentations } from '@cornerstonejs/tools/enums';

import OHIF from '@ohif/core';

const { DisplaySetApi } = OHIF.display;

// Segment presentation state may come from two sources:
//   'viewport' (default) — colour/visibility read through the per-viewport config APIs; requires
//     at least one viewport with the segmentation registered (all existing labelmap panels).
//   'metadata' — colour/visibility read from the segment metadata fields (segments[idx].color as a
//     hex string, segments[idx].visible); no viewports are required. Used by panels whose viewers
//     are not part of the Cornerstone3D rendering system (M3D/Three.js — see AR-2 on
//     oak-tree/medical-imaging/ohif-viewers#120). Active and locked always use the viewport-free
//     segmentIndex/segmentLocking APIs.

function _metaSegmentColor(metaSegment) {
  // Translate a metadata hex colour to the [r, g, b, a] shape returned by getSegmentIndexColor.
  if (!metaSegment?.color) {
    return undefined;
  }
  return [...OHIF.utils.color.hex2rgb(metaSegment.color), 255];
}


export function syncTableSegRepData(seg, tableSeg, options) {
  // Synchronize the provided table segmentation against Cornerstone3D state.

  options = options || {};
  _.defaults(options, { color: true, label: true, active: true, lock: true, source: 'viewport', });
  _.defaults(options, { visible: options.source == 'metadata', });

  const _metaSource = options.source == 'metadata';

  const { segmentationId } = tableSeg.segmentation;
  if (!segmentationId || segmentationId != seg.segmentationId) {
    throw new Error('Unable to check table segmentation structure against Cornerstone3D, no segmentationId available');
  }

  // Update segmentation attributes
  tableSeg.segmentation.label = seg.label;

  // Within Cornerstone3D, state is kept on a per-viewport basis. Retrieve active viewports associated
  // with the segmentation. (Metadata mode has no registered viewports and reads segment metadata instead.)
  let _v3d_id0;
  if (!_metaSource) {
    const active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(segmentationId);
    if (!active_viewports?.length) {
      throw new Error('Unable to translate c3dSegmentation structure to Segmentation table structure, no active viewports');
    }

    // Since the segmentation editor viewports are synchronizd, use the first viewport for retrieving state information.
    _v3d_id0 = active_viewports[0];
  }

  const _segmentAttrs = (s, idx) => {
    // Update segment attirbutes

    // Update segmentation color
    if (options.color) {
      s.color = _metaSource
        ? (_metaSegmentColor(seg.segments[idx]) || s.color)
        : c3dSegmentations.config.color.getSegmentIndexColor(_v3d_id0, segmentationId, idx);
    }

    // Update segment visibility (metadata mode only; viewport mode tracks visibility through
    // the per-viewport config APIs and local table mutations)
    if (options.visible && _metaSource && !_.isNil(seg.segments[idx]?.visible)) {
      s.visible = seg.segments[idx].visible;
    }

    // Update segment label
    if (options.label && seg.segments[idx] && seg.segments[idx].label != s.label) {
      s.label = seg.segments[idx].label;
    }

    // Update segment active
    if (options.active && !_.isNil(seg.segments[idx]?.active)) {
      s.active = idx == c3dSegmentations.segmentIndex.getActiveSegmentIndex(segmentationId);
    }

    // Update segment lock
    if (options.lock) {
      s.locked = c3dSegmentations.segmentLocking.isSegmentIndexLocked(segmentationId, idx);
    }

    return s;
  }

  // Update attributes for both the representation and the segmentation
  if (tableSeg?.representation?.segments) {
    tableSeg.representation.segments = _.mapValues(tableSeg.representation.segments, _segmentAttrs);
  }
  if (tableSeg?.segmentation?.segments) {
    tableSeg.segmentation.segments = _.mapValues(tableSeg.segmentation.segments, _segmentAttrs);
  }

  return tableSeg;
}


export function checkSegmentsLength(seg, tableSeg) {
  // Return the count of segmentations in the segmentation versus the table segmentation.
  
  return {
    meta: _.values(seg.segments).length, table: _.values(tableSeg.representation.segments).length,
  };
}


export function createSyncStyleAttrsCommand({
  setRenderFillState, renderFillRef, setRenderFillInactiveState, renderFillInactiveRef,
  setRenderOutlineState, renderOutlineRef, setRenderOutlineInactiveState, renderOutlineInactiveRef,
  setFillAlphaState, fillAlphaRef, setRenderOutlineWidthState, outlineWidthRef
}) {
  // Create a command function for synchronizing a style object with the render state of the segmentation table
  // used by the Sonador viewer. Accepts setState function from the useState hook and reference
  // objects created via useRef.

  // @returns a command which performs property comparisons and mutates style attributes which have changed.
  
  return (style, options) => {
    // Synchronize the provided style definition with the configuration attributes in the segmentation table
    
    options = options || {};
    _.defaults(options, { force: false, })

    // Render options: renderFill, renderFillInactive, renderOutline, renderOutlineInactive
    if ((!_.isNil(style.renderFill) && style.renderFill != renderFillRef.current) || options.force) {
      setRenderFillState(style.renderFill);
      renderFillRef.current = style.renderFill;
    }
    if ((!_.isNil(style.renderFillInactive && style.renderFillInactive != renderFillInactiveRef.current)) || options.force) {
      setRenderFillInactiveState(style.renderFillInactive);
      renderFillInactiveRef.current = style.renderFillInactive;
    }
    if ((!_.isNil(style.renderOutline) && style.renderOutline != renderOutlineRef.current) || options.force) {
      setRenderOutlineState(style.renderOutline);
      renderOutlineRef.current = style.renderOutline;
    }
    if ((!_.isNil(style.renderOutlineInactive) && style.renderOutlineInactive != renderOutlineInactiveRef.current) || options.force) {
      setRenderOutlineInactiveState(style.renderOutlineInactive);
      renderOutlineInactiveRef.current = style.renderOutlineInactive;
    }

    // Alpha Opacity
    if ((_.isNumber(style?.fillAlpha) && style.fillAlpha != fillAlphaRef.current) || options.force) {
      setFillAlphaState(style.fillAlpha);
      fillAlphaRef.current = style.fillAlpha;
    }

    // Outline Width
    if ((_.isNumber(style?.outlineWidth) && style.outlineWidth != outlineWidthRef.current || options.force)) {
      setRenderOutlineWidthState(style.outlineWidth);
      outlineWidthRef.current = style.outlineWidth;
    }
  }
}


export function createViewerOnToggleSegmentVisibility({ displaySetInstanceUID, setSegmentations, segmentationsRef }, fnOptions) {
  // Create a command function for toggling the visibility of a segmentation segment

  // @returns a command which toggles the Cornerstone3D visibility configuration for a selected segmentationId and segmentIndex

  fnOptions = fnOptions || {};
  _.defaults(fnOptions, {
    segmentationType: SegmentationRepresentations.Labelmap
  });

  return (segmentationId, segIdx, segType, isVisible, options) => {
    // Toggle the visibility of the selected segment
    
    options = options || {};
    _.defaults(options, { view3d: true, segTable: true, });

    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    let segTableVisible;

    // Toggle 3D viewport
    if (_ds && _ds.segmentationId && options.view3d) {
      const _v3d_active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(_ds.segmentationId);
      for (const _v3d_id of _v3d_active_viewports) {

        // Retrieve visibility for the selected segment
        const _visible = !_.isNil(isVisible) ? isVisible : !c3dSegmentations.config.visibility.getSegmentIndexVisibility(
          _v3d_id, { segmentationId: _ds.segmentationId, type: fnOptions.segmentationType, }, segIdx);
        c3dSegmentations.config.visibility.setSegmentIndexVisibility(_v3d_id, {
          segmentationId: _ds.segmentationId, type: fnOptions.segmentationType,
        }, segIdx, _visible);

        // Set segTableVisible state
        segTableVisible = _visible
      }
    }

    if (segmentationsRef.current && !_.isNil(segTableVisible) && options.segTable) {

      // Retrieve segement from reference
      const _seg = segmentationsRef.current[0];
      _seg.representation.segments[segIdx].visible = !_.isNil(segTableVisible) ? segTableVisible : isVisible;

      // Mutate componet state      
      setSegmentations([_seg]);
    }
  }
}


export function checkActiveSeg(seg, segmentationsRef, segmentationIdRef) {
  // Verify that the provided segmentation matches the currently active segmentation

  if (segmentationsRef.current && segmentationsRef.current.length > 0) {
    const _seg = segmentationsRef.current[0];
    return seg?.segmentation?.segmentationId && seg?.segmentation?.segmentationId == segmentationIdRef.current;
  }

  return false;
}


export function tableSgmentationRepVisible(segmentationsRef) {
  // Determine if the current table segmentation representation is visible

  let _visible;
  const _tableSeg = segmentationsRef.current?.length ? segmentationsRef.current[0] : undefined;
  if (_tableSeg && _tableSeg?.representation?.segments) {
    const segmentsOff = _.every(_tableSeg.representation.segments, (s) => !s.visible);
    if (segmentsOff) { _visible = false; }
  }

  return _visible;
}



export function mutateSegmentationTableRepresentationVisibility(segmentationId, setSegmentations, segmentationsRef, segTableVisible) {
  // Mutate the visibility of the segmentation table representation

  const _mutateVisible = (s, idx) => {
    s.visible = segTableVisible;
    s.active = idx == c3dSegmentations.segmentIndex.getActiveSegmentIndex(segmentationId);
    return s;
  }
    
  // Retrieve segmentation from reference an dupdate visible properties
  const _seg = segmentationsRef.current[0];
  _seg.representation.segments = _.mapValues(_seg.representation.segments, _mutateVisible);
  _seg.segmentation.segments = _.mapValues(_seg.segmentation.segments, _mutateVisible);

  // Mutate component state      
  setSegmentations([_seg]);
}


export function createViewerOnToggleSegmentationRepresentationVisibility({ setSegmentations, segmentationsRef, segmentationIdRef }) {
  // Toggle the visbility of the selected segmentation

  return (segmentationId, segType) => {

    // Check visibility of segments
    let _visible = tableSgmentationRepVisible(segmentationsRef);
    let segTableVisible;

    // Toggle viewports
    const active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(segmentationId)
    for (const _v3d_id of active_viewports) {

      // If unable to determine segmentation visibility from the table state, retrieve from c3dSegmentations metadata.
      const visible = !_.isNil(_visible) ? _visible : c3dSegmentations.config.visibility.getSegmentationRepresentationVisibility(_v3d_id, { segmentationId, type: segType });

      // Toggle visibility to opposite state of current
      c3dSegmentations.config.visibility.setSegmentationRepresentationVisibility(_v3d_id, {
        segmentationId, type: segType || c3dToolsEnums.SegmentationRepresentations.Labelmap
      }, !visible);
      segTableVisible = !visible;
    }

    // Change Visibility of segmentation table / mutate state
    if (checkActiveSeg(segmentationsRef.current?.length ? segmentationsRef.current[0] : undefined, segmentationsRef, segmentationIdRef)) {    
      console.log('Mutate seg rep visibility!');
      mutateSegmentationTableRepresentationVisibility(segmentationId, setSegmentations, segmentationsRef, segTableVisible);
    }
  }
}


export function c3dSeg2SegmentationTableData(c3dSeg, options) {
  /**
  * Map a Cornerstone3D Segmentation state object to the shape expected by the @ohif/ui-next SegmentationTable component.
   *
  * The representation is synthesised with defaults since this panel operates
  * on the segmentation state directly rather than through a specific viewport.
  */
  options = options || {};
  _.defaults(options, {
    type: SegmentationRepresentations.Labelmap,
    source: 'viewport',
  })

  const _metaSource = options.source == 'metadata';

  let active_viewports, _v3d_id0;
  if (!_metaSource) {
    active_viewports = c3dSegmentations.state.getViewportIdsWithSegmentation(c3dSeg.segmentationId);
    if (!active_viewports?.length) {
      throw new Error('Unable to translate c3dSegmentation structure to Segmentation table structure, no active viewports');
    }

    // Since the segmentation editor viewports are synchronizd, use the first viewport for retrieving state information.
    _v3d_id0 = active_viewports[0];
  }

  // Visibility of the segmentation: across all active viewports, or across the segment metadata
  // (segments default to visible when the metadata flag is unset)
  const visible = _metaSource
    ? _.every(c3dSeg.segments, (_s) => _s.visible !== false)
    : _.every(_.map(active_viewports, (_v3d_id) => {
        return c3dSegmentations.config.visibility.getSegmentationRepresentationVisibility(_v3d_id, {
          segmentationId: c3dSeg.segmentationId, type: SegmentationRepresentations.Labelmap,
        });
      }));

  // Segmentation table data representation of segments
  const tableSegments = _.mapValues(c3dSeg.segments, (_s, idx) => {

    // Base properties for the segment
    let s = _.pick(_s, 'segmentIndex', 'label');

    // Set state of segment visibility from the state of the segmentation visibility.
    // If the segmentation is toggled off, all segments should also show as toggled off.
    // If the segmentation is toggled on, then the state of the segment should be whatever
    // the visibility of the segment (as determined by the metadata/config) is.
    // (In metadata mode the segment flag is the sole source — there is no separate
    // representation-level switch to combine with.)
    if (_metaSource) {
      s.visible = _s.visible !== false;
    } else {
      const segVisible = _.every(active_viewports, (_v3d_id) => {
        return c3dSegmentations.config.visibility.getSegmentIndexVisibility(_v3d_id, {
          segmentationId: c3dSeg.segmentationId, type: SegmentationRepresentations.Labelmap,
        }, idx);
      });
      s.visible = visible ? segVisible : visible;
    }

    // Get active and locked state state from segmentation state
    s.active = idx == c3dSegmentations.segmentIndex.getActiveSegmentIndex(c3dSeg.segmentationId);
    s.locked = c3dSegmentations.segmentLocking.isSegmentIndexLocked(c3dSeg.segmentationId, idx);

    // Retrieve segmentation color
    s.color = _metaSource
      ? _metaSegmentColor(_s)
      : c3dSegmentations.config.color.getSegmentIndexColor(_v3d_id0, c3dSeg.segmentationId, idx);
    return s;
  });

  // Retrieve the display style for the segmentation
  const _style = c3dSegmentations.config.style.getStyle({
    segmentationId: c3dSeg.segmentationId, type: options.type,
  });

  // Table segmentation properties: populates the segmentation table
  const tableSeg = {
    segmentation: {
      segmentationId: c3dSeg.segmentationId,
      label: c3dSeg.label,
      fallbackLabel: c3dSeg.fallbackLabel,
      cachedStats: c3dSeg.cachedStats,
      segments: tableSegments || {},
    },
    representation: {
      active: true,
      visible,
      type: options.type,
      styles: _style,
      segments: tableSegments || {},
    },
  };

  return tableSeg;
}


export function attachCoreSegmentationTableEvents({
    segmentationService, setSegmentations, segmentationsRef, setActiveSegmentationId, segmentationIdRef,
    setSegmentationsVisible, segmentationsVisibleRef, 
  }, options) {
  // Attach displaySet and segmentationService events for the sonador segmentation table.

  // @event displaysets_dataupdate: event handler for displaySetApi updates. Sets the ID of the
  //  active segmentation.
  // @event c3d_segdata_modified: service subscription for segmentation modified events.
  //  Handles segmentation add and update events.

  // @returns subscription handles (both expose .unsubscribe())

  options = options || {};
  _.defaults(options, { logPrefix: 'SegmentationPanel', source: 'viewport', bootstrapEmptyTable: false });

  if (!segmentationService) {
    throw new Error('Unable to attach core segmentation table events, invalid segmentationService reference.');
  }

  // displaySet API: displaySet added or changed. The first publication of a displaySet through
  // addDisplaySets emits DISPLAY_SET_ADDED (the displaySet was not previously in the service
  // cache), so both events must be handled or a panel that mounts before the viewport publishes
  // never receives the segmentationId.
  const _onDisplaySetUpdate = ({ displaySetInstanceUID, displaySet }) => {
    console.log(`[${options.logPrefix}:evt:displayset-updated]`, displaySetInstanceUID, displaySet);

    // Update the active segmentationId for the editor panel.
    // Also update the ref synchronously so that event handlers registered in the same render cycle
    // (segservice_segdata_modified, segservice_segrep_updates) can match events that fire before React re-renders.
    if (displaySet.segmentationId && displaySet.segmentationId != segmentationIdRef.current) {
      setActiveSegmentationId(displaySet.segmentationId);
      segmentationIdRef.current = displaySet.segmentationId;
    }

    // Toggle segmentations controls on/off
    if (!_.isNil(displaySet.segmentationSurfaceEnabled) && _.isFunction(setSegmentationsVisible)) {
      setSegmentationsVisible(displaySet.segmentationSurfaceEnabled);
      segmentationsVisibleRef.current = displaySet.segmentationSurfaceEnabled;
    }
  };

  const _displaysets_changed = DisplaySetApi.Instance.displaySetService.subscribe(
    DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_CHANGED, _onDisplaySetUpdate);
  const _displaysets_added = DisplaySetApi.Instance.displaySetService.subscribe(
    DisplaySetApi.Instance.displaySetService.EVENTS.DISPLAY_SET_ADDED, _onDisplaySetUpdate);

  // Single handle covering both subscriptions, so existing callers' cleanup remains a
  // single .unsubscribe() call.
  const displaysets_dataupdate = {
    unsubscribe: () => {
      _displaysets_changed.unsubscribe();
      _displaysets_added.unsubscribe();
    },
  };


  // Segmentation service: segmentation data modified
  // Subscribe via the OHIF segmentationService so cleanup is a simple .unsubscribe() call,
  // avoiding the capture-flag and void-return pitfalls of c3dEventTarget.addEventListener.
  const segservice_segdata_modified = segmentationService.subscribe(
    segmentationService.EVENTS.SEGMENTATION_MODIFIED, ({ segmentationId }) => {
    console.log(`[${options.logPrefix}:evt:segdata-modified] segmentationId=${segmentationId}`);

    if (segmentationId && segmentationId == segmentationIdRef.current) {

      // Initialize segmentation table data (new load)
      const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
      const _tableSeg = segmentationsRef.current?.length > 0 ? segmentationsRef.current[0] : undefined;
      console.log(`[${options.logPrefix}:evt:segdata-modified]`, _seg);

      if (_seg && !_tableSeg && options.bootstrapEmptyTable) {

        // Bootstrap an empty table from the segmentation metadata. Panels without registered
        // viewport representations (M3D) have no SEGMENTATION_REPRESENTATION_MODIFIED bootstrap
        // path, so a panel mounted before the viewport registers must populate here.
        const tableSeg = c3dSeg2SegmentationTableData(_seg, { source: options.source });
        setSegmentations([tableSeg]);

      } else if (_seg && _tableSeg) {

        // Determine if the data should be synchronized or re-generated
        const _count = checkSegmentsLength(_seg, _tableSeg);
        if (_count.meta && _count.meta > _count.table) {

          // New segment added, generate segmentation table data structure
          const tableSeg = c3dSeg2SegmentationTableData(_seg, { source: options.source });
          setSegmentations([tableSeg]);

          // Trigger onAddSegment callback
          if (_.isFunction(options.onAddSegment)) {
            options.onAddSegment({ segmentationId, seg: _seg, tableSeg });
          }

        } else {

          // Synchronize the table segmentation state from Cornerstone3D meta
          const tableSeg = syncTableSegRepData(_seg, _tableSeg, { source: options.source });
          setSegmentations([tableSeg]);

          // Trigger onSegmentUpdate callback
          if (_.isFunction(options.onSegmentUpdate)) {
            options.onSegmentUpdate({ segmentationId, seg: _seg, tableSeg });
          }
        }
      }
    }
  });


  return { displaysets_dataupdate, segservice_segdata_modified, }
}


export function attachSegmentationAddTableEvents({
    segmentationService, displaySetInstanceUID, setActiveSegmentationId, segmentationIdRef,
  }, options) {
  // Attach segmentationService segmentation add events for the Sonador segmentation table.

  // @param displaySetInstanceUID: displaySetInstanceUID instance for the handler.

  // @event segservice_seg_added: event handler for segmentation added event

  // @returns subscription reference  (references provide .unsubscribe() methods for deactivating callbacks as part of cleanup)

  options = options || {};
  _.defaults(options, { logPrefix: 'SegmentationPanel' });

  if (!segmentationService) {
    throw new Error('Unable to attach segmentation representation table events, invalid segmentationService reference.');
  }
  
  const segservice_seg_added = segmentationService.subscribe(segmentationService.EVENTS.SEGMENTATION_ADDED, ({ segmentationId }) => {
    // Set currently active segmentationId

    const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
    if (segmentationId && _ds?.segmentationId == segmentationId && segmentationId != segmentationIdRef.current) {
      
      setActiveSegmentationId(segmentationId);
      segmentationIdRef.current = segmentationId;

      // Trigger callback
      if (_.isFunction(options.onAddSegmentation)) {
        const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
        options.onAddSegmentation({ segmentationId, seg: _seg ,});
      }
    }
  });

  return { segservice_seg_added };
}


export function attachSegmentationRepresentationTableEvents({
  segmentationService, displaySetInstanceUID,
  setSegmentations, segmentationsRef, setActiveSegmentationId, segmentationIdRef,
  setFillAlphaState, fillAlphaRef, setRenderOutlineWidthState, outlineWidthRef, syncStyleAttrs,
}, options) {
  // Attach segmentationService representation events for the Sonador segmentation table.

  // @param displaySetInstanceUID: optional. When provided, used to validate bootstrap events
  //  against the displaySet so that unrelated segmentation representations are ignored.

  // @event segservice_segrep_updates: service subscription for segmentation representation updates.
  // @event segservice_style_updates: service subscription for style modifications (only attached
  //  when syncStyleAttrs is provided, absorbing the inline subscription from the calling panel).

  // @returns subscription references (references provide .unsubscribe() methods for deactivating callbacks as part of cleanup)

  options = options || {};
  _.defaults(options, { logPrefix: 'SegmentationPanel' });

  if (!segmentationService) {
    throw new Error('Unable to attach segmentation representation table events, invalid segmentationService reference.');
  }

  const segservice_segrep_updates = segmentationService.subscribe(
    segmentationService.EVENTS.SEGMENTATION_REPRESENTATION_MODIFIED, ({ segmentationId, viewportId: _v3d_id }) => {

    if (!segmentationId || !_v3d_id) return;

    // Determine whether this event is relevant to this panel. Two paths:
    //
    // 1. Normal path: segmentationId matches the established ref.
    //
    // 2. Bootstrap path: the ref is not yet set and the table is empty. This occurs when the
    //    panel mounts before the segmentation finishes loading — the ref is never populated by
    //    the first-load block or DISPLAY_SET_CHANGED because those may fire at the same time as,
    //    or after, the viewport's addSegmentationRepresentations call. When bootstrapping,
    //    validate against the displaySet when possible to avoid accepting unrelated segmentations;
    //    if _ds.segmentationId is not yet set, accept the event (best-effort).
    const matchesRef = segmentationId == segmentationIdRef.current;
    const needsBootstrap = !segmentationIdRef.current && segmentationsRef.current?.length == 0;

    if (!matchesRef) {
      if (!needsBootstrap) return;

      if (displaySetInstanceUID) {
        const _ds = DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
        if (_ds?.segmentationId && _ds.segmentationId != segmentationId) return;
      }

      // Bootstrap: establish the ref synchronously so subsequent events (SEGMENTATION_MODIFIED,
      // SEGMENTATION_STYLE_MODIFIED) also match without waiting for a React re-render.
      console.log(`[${options.logPrefix}:evt:segrep-modified] bootstrap segmentationId=` + segmentationId);
      setActiveSegmentationId(segmentationId);
      segmentationIdRef.current = segmentationId;
    }

    // Retrieve Cornerstone3D segmentation meta and table state
    const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
    const _tableSeg = segmentationsRef.current?.length > 0 ? segmentationsRef.current[0] : undefined;
    console.log(`[${options.logPrefix}:evt:segrep-modified]`, _tableSeg);

    if (_seg) {
      const _style = c3dSegmentations.config.style.getStyle({
        segmentationId, type: SegmentationRepresentations.Labelmap,
      });

      // Alpha Opacity
      if (_style && _style.fillAlpha != fillAlphaRef.current) {
        setFillAlphaState(_style.fillAlpha);
        fillAlphaRef.current = _style.fillAlpha;
      }

      // Outline Width
      if (_style && _style.outlineWidth != outlineWidthRef.current) {
        setRenderOutlineWidthState(_style.outlineWidth);
        outlineWidthRef.current = _style.outlineWidth;
      }

      console.log(`[${options.logPrefix}:evt:segrep-modified] segmentation styles`, _style);
    }

    if (_seg && segmentationsRef.current?.length == 0) {

      // Translate segmentation data to tableSeg and update state
      const tableSeg = c3dSeg2SegmentationTableData(_seg);
      setSegmentations([tableSeg]);

      // Trigger onAddSegmentationRepresentation callback
      if (_.isFunction(options.onAddSegmentationRepresentation)) {
        options.onAddSegmentationRepresentation({ segmentationId, seg: _seg, tableSeg });
      }

    } else if (_seg && _tableSeg) {

      // Synchronize the table segmentation state from Cornerstone3D meta
      const tableSeg = syncTableSegRepData(_seg, _tableSeg);
      setSegmentations([tableSeg]);

      // Trigger onUpdateSegmentationRepresentation
      if (_.isFunction(options.onSegmentationRepresentationUpdate)) {
        options.onSegmentationRepresentationUpdate({ segmentationId, seg: _seg, tableSeg });
      }
    }
  });

  // Segmentation style updates: absorb the inline SEGMENTATION_STYLE_MODIFIED subscription
  // from the calling panel when syncStyleAttrs is provided.
  let segservice_style_updates;
  if (_.isFunction(syncStyleAttrs)) {
    segservice_style_updates = segmentationService.subscribe(
      segmentationService.EVENTS.SEGMENTATION_STYLE_MODIFIED, ({ specifier, style }) => {
        const segmentationId = specifier?.segmentationId;
        if (segmentationId && segmentationId == segmentationIdRef.current) {
          console.log(`[${options.logPrefix}:evt:style-modified] segmentationId=` + segmentationId, style);
          syncStyleAttrs(style);
        }
      });
  }

  return { segservice_segrep_updates, segservice_style_updates };
}


export function attachSegmentRemovedTableEvents({ segmentationService, setSegmentations, segmentationsRef }, options) {
  // Attach OHIF segmentationService segment events for the Sonador segmentation table.
  options = options || {};
  _.defaults(options, { logPrefix: 'SegmentationPanel' });

  if (!segmentationService) {
    throw new Error('Unable to attach segment removed table events, invalid segmentationService reference.');
  }
  
  const segservice_segment_removed = segmentationService.subscribe(segmentationService.EVENTS.SEGMENT_REMOVED, ({ segmentationId, segmentIndex }) => {

    const _seg = c3dSegmentations.state.getSegmentation(segmentationId);
    console.log(`[${options.logPrefix}:evt:segment-removed]`, _seg);

    // Remove segmentation from tableSeg data
    const _tableSeg = segmentationsRef.current?.length ? segmentationsRef.current[0] : undefined;
    if (_tableSeg && _tableSeg?.representation?.segments?.[segmentIndex]) {
      delete _tableSeg.representation.segments[segmentIndex];
      delete _tableSeg.segmentation.segments[segmentIndex];

      // Update the Segmentation table
      setSegmentations([_tableSeg]);

      if (_.isFunction(options.onSegmentRemoved)) {
        options.onSegmentRemoved({ segmentationId, segmentIndex, })
      }
    }
  });

  return { segservice_segment_removed, }
}