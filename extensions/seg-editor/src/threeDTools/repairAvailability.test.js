// Whether Repair can run, and the reason shown when it cannot

import { REPAIR_REASONS,repairAvailability } from './repairAvailability';

const target = { segmentIndex: 1, label: 'Liver' };
const sound = { boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, inconsistentEdgeCount: 0, closed: true };

describe('repairAvailability', () => {
  it('names the reason for every disabled state', () => {
    expect(repairAvailability({})).toMatchObject({ enabled: false, reason: REPAIR_REASONS.noTarget, message: 'Select a segment to repair' });
    expect(repairAvailability({ target: { segmentIndex: 1, disabledReason: 'The selected segment is locked' } }))
      .toMatchObject({ enabled: false, reason: REPAIR_REASONS.noTarget, message: 'The selected segment is locked' });
    expect(repairAvailability({ target, preview: { holes: 1 }, surfaceHealth: sound }))
      .toMatchObject({ enabled: false, reason: REPAIR_REASONS.preview, message: expect.stringMatching(/Finish or cancel/) });
    expect(repairAvailability({ target, busy: true, surfaceHealth: sound }))
      .toMatchObject({ enabled: false, reason: REPAIR_REASONS.busy });
    expect(repairAvailability({ target, surfaceHealth: null }))
      .toMatchObject({ enabled: false, reason: REPAIR_REASONS.checking, message: 'Checking the surface...' });
    expect(repairAvailability({ target, surfaceHealth: sound }))
      .toMatchObject({ enabled: false, reason: REPAIR_REASONS.noDefect, message: expect.stringMatching(/does not make the surface a valid solid/) });
  });

  it('enables Repair for open, non-manifold or inverted edges alike', () => {
    expect(repairAvailability({ target, surfaceHealth: { ...sound, boundaryEdgeCount: 4, closed: false } }))
      .toMatchObject({ enabled: true, reason: REPAIR_REASONS.defects, values: { open: 4, nonManifold: 0, inconsistent: 0 } });
    expect(repairAvailability({ target, surfaceHealth: { ...sound, nonManifoldEdgeCount: 1, closed: false } }).enabled).toBe(true);
    // Reversed faces alone used to leave the button disabled
    expect(repairAvailability({ target, surfaceHealth: { ...sound, inconsistentEdgeCount: 3, closed: false } }))
      .toMatchObject({ enabled: true, values: { inconsistent: 3 } });
  });
});
