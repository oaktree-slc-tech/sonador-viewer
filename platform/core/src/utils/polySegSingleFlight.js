/**
 * Wrap the @cornerstonejs/polymorphic-segmentation addon so that concurrent surface
 * computations for the same segmentation coalesce onto a single in-flight job.
 *
 * Why this exists
 * ---------------
 * Cornerstone3D's Surface display tool (tools/displayTools/Surface/surfaceDisplay.render)
 * lazily computes surface data whenever a Surface representation is rendered while
 * `segmentation.representationData.Surface` is still empty:
 *
 *     SurfaceData = await computeAndAddRepresentation(
 *       segmentationId, Surface, () => polySeg.computeSurfaceData(segmentationId, { viewport }));
 *
 * Surface renders are scheduled on requestAnimationFrame and fired fire-and-forget by
 * SegmentationRenderingEngine._triggerRender (it does not await display.render). So any event
 * that re-renders the 3D viewport while the (seconds-to-minutes) surface computation is still
 * running — a color LUT change, SEGMENTATION_DATA_MODIFIED, a representation-modified event,
 * React setState churn from worker-progress, etc. — finds representationData.Surface still
 * empty and kicks off ANOTHER full computeSurfaceData. Each computeSurfaceData fans out to one
 * marching-cubes worker job per segment, and registerPolySegWorker runs a single worker
 * instance (maxWorkerInstances: 1), so duplicate triggers pile (retriggers x segments) jobs
 * onto one worker. The queue never drains (so autoTerminateOnIdle never fires) and startup
 * stalls for minutes.
 *
 * Cornerstone3D already guards the equivalent Labelmap conversion path with a module-level
 * `polySegConversionInProgress` boolean (tools/displayTools/Labelmap/labelmapDisplay.render),
 * but the Surface path has no such guard. This wrapper supplies the missing guard at the addon
 * boundary — the single point that getPolySeg() returns to every caller — so the lazy render
 * path and any explicit caller all share one computation per segmentation. Once the first
 * computation resolves and Cornerstone3D stores representationData.Surface, the lazy path stops
 * calling compute entirely, so the in-flight window is exactly the compute duration: precisely
 * when coalescing is needed.
 *
 * @param {object} polySeg - The polymorphic-segmentation module namespace passed to
 *   cornerstoneTools.init({ addons: { polySeg } }).
 * @returns {object} A drop-in replacement addon with a single-flight computeSurfaceData.
 */
export function createSingleFlightPolySeg(polySeg) {
  // Keyed by `${segmentationId}::${segmentIndices}` so distinct per-segment requests do not
  // incorrectly share a job, while the common "compute the whole surface" calls (no indices)
  // all collapse onto one entry.
  const inFlight = new Map();

  const keyFor = (segmentationId, options = {}) => {
    const indices = options.segmentIndices?.length
      ? [...options.segmentIndices].sort((a, b) => a - b).join(',')
      : 'all';
    return `${segmentationId}::${indices}`;
  };

  const computeSurfaceData = (segmentationId, options = {}) => {
    const key = keyFor(segmentationId, options);

    const existing = inFlight.get(key);
    if (existing) {
      // A computation for this segmentation is already running; await the same result instead
      // of launching a duplicate fan-out of marching-cubes worker jobs.
      return existing;
    }

    // Promise.resolve() normalizes the result so callers can always `.finally()`/`await` it,
    // even if a future polySeg implementation returns a non-promise.
    const job = Promise.resolve(polySeg.computeSurfaceData(segmentationId, options));

    inFlight.set(key, job);
    // Clear once settled (success or failure) so a later legitimate recompute — e.g. after the
    // surface is removed and needs regeneration — is not blocked by a stale entry.
    job.finally(() => {
      if (inFlight.get(key) === job) {
        inFlight.delete(key);
      }
    });

    return job;
  };

  // Spread preserves every other addon method (init, canComputeRequestedRepresentation,
  // computeLabelmapData, computeContourData, updateSurfaceData, ...) by reference; only the
  // surface computation is wrapped.
  return {
    ...polySeg,
    computeSurfaceData,
  };
}

export default createSingleFlightPolySeg;
