import { aclKeyOf, isPolicyDirty, markDirtyPolicies, reconcileAclList } from './aclReconcile';


describe('aclKeyOf', () => {
  it('keys user and group policies into separate namespaces', () => {
    // A user and a group can share a numeric id; keying on the bare id would collide them.
    expect(aclKeyOf({ User: 7 })).toBe('user:7');
    expect(aclKeyOf({ Group: 7 })).toBe('group:7');
    expect(aclKeyOf({ User: 7 })).not.toBe(aclKeyOf({ Group: 7 }));
  });

  it('keys a user policy whose id is 0 as a user, not a group', () => {
    // `acl.User ? ... : ...` would send this down the group branch.
    expect(aclKeyOf({ User: 0 })).toBe('user:0');
  });
});


describe('reconcileAclList', () => {
  const group = (Group, overrides = {}) => ({
    ID: `acl-${Group}`,
    Group,
    name: `Group ${Group}`,
    View: true,
    Modify: false,
    Remove: false,
    ACL: false,
    ...overrides,
  });

  it('drops a policy the server no longer reports', () => {
    // The delete case. Previously the refetch re-added the row the user had just revoked.
    const local = [group(1), group(2)];
    const server = [group(2)];

    expect(reconcileAclList(server, local).map((a) => a.Group)).toEqual([2]);
  });

  it('drops every revoked policy, not just the first', () => {
    // Two revokes in a row against one dialog -- the reported defect.
    const afterFirst = reconcileAclList([group(2), group(3)], [group(1), group(2), group(3)]);
    expect(afterFirst.map((a) => a.Group)).toEqual([2, 3]);

    const afterSecond = reconcileAclList([group(3)], afterFirst);
    expect(afterSecond.map((a) => a.Group)).toEqual([3]);
  });

  it('keeps unsaved permission edits when the query refetches', () => {
    const local = [group(1, { Modify: true, isUpdated: true })];
    const server = [group(1)];

    const [reconciled] = reconcileAclList(server, local);

    expect(reconciled.Modify).toBe(true);
    expect(reconciled.isUpdated).toBe(true);
  });

  it('adopts the server identity for an edited policy', () => {
    // The save path chooses PUT over POST on the presence of ID, so an edited row must not lose it.
    const local = [group(1, { ID: undefined, Modify: true, isUpdated: true })];
    const server = [group(1, { ID: 'acl-server-1', name: 'Renamed' })];

    const [reconciled] = reconcileAclList(server, local);

    expect(reconciled.ID).toBe('acl-server-1');
    expect(reconciled.name).toBe('Renamed');
    expect(reconciled.Modify).toBe(true);
  });

  it('takes the server permissions for a policy the user has not touched', () => {
    const local = [group(1, { Modify: false })];
    const server = [group(1, { Modify: true })];

    expect(reconcileAclList(server, local)[0].Modify).toBe(true);
  });

  it('preserves a pending addition the server has never seen', () => {
    const pending = { Group: 9, name: 'Pending', View: true, isUpdated: true };

    const reconciled = reconcileAclList([group(1)], [group(1), pending]);

    expect(reconciled.map((a) => a.Group)).toEqual([1, 9]);
  });

  it('surfaces a policy added elsewhere', () => {
    expect(reconcileAclList([group(1), group(2)], [group(1)]).map((a) => a.Group)).toEqual([1, 2]);
  });

  it('does not duplicate a pending addition once the server confirms it', () => {
    const pending = { Group: 9, name: 'Pending', View: true, isUpdated: true };

    const reconciled = reconcileAclList([group(9)], [pending]);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0].ID).toBe('acl-9');
  });

  it('tolerates missing arguments', () => {
    expect(reconcileAclList()).toEqual([]);
    expect(reconcileAclList([group(1)])).toHaveLength(1);
    expect(reconcileAclList(undefined, [group(1, { ID: undefined })])).toHaveLength(1);
  });
});


describe('isPolicyDirty', () => {
  const server = { ID: 'acl-1', Group: 1, View: true, Modify: false, Remove: false, ACL: false };

  it('is false when every editable permission matches the server', () => {
    expect(isPolicyDirty({ ...server }, server)).toBe(false);
  });

  it('is true when an editable permission differs', () => {
    expect(isPolicyDirty({ ...server, Modify: true }, server)).toBe(true);
  });

  it('is true for a policy the server has never seen', () => {
    expect(isPolicyDirty({ Group: 9, View: true }, undefined)).toBe(true);
  });

  it('counts the comment permissions, which are editable too', () => {
    // All six permissions the gateway stores are rendered as checkboxes, so a change to either
    // comment permission has to light up Save like any other.
    expect(isPolicyDirty({ ...server, CommentEdit: true }, server)).toBe(true);
    expect(isPolicyDirty({ ...server, CommentView: true }, server)).toBe(true);
  });

  it('treats undefined and false as the same value', () => {
    // Server rows omit a permission that is off; local rows carry an explicit false.
    expect(isPolicyDirty({ Group: 1, View: true, Modify: false }, { Group: 1, View: true })).toBe(false);
  });
});


describe('markDirtyPolicies', () => {
  const server = [{ ID: 'acl-1', Group: 1, View: true, Modify: false }];

  it('clears the flag when a permission is toggled back to its original value', () => {
    // The reported defect: `isUpdated` was asserted on every toggle and never revisited, so
    // turning Modify on and off again left the dialog dirty with nothing to save.
    const on = markDirtyPolicies([{ ID: 'acl-1', Group: 1, View: true, Modify: true }], server);
    expect(on[0].isUpdated).toBe(true);

    const restored = markDirtyPolicies([{ ...on[0], Modify: false }], server);
    expect(restored[0].isUpdated).toBe(false);
  });

  it('flags a pending addition the server has never seen', () => {
    expect(markDirtyPolicies([{ Group: 9, View: true }], server)[0].isUpdated).toBe(true);
  });

  it('returns unchanged rows by reference so React sees no update', () => {
    const clean = [{ ID: 'acl-1', Group: 1, View: true, Modify: false, isUpdated: false }];

    expect(markDirtyPolicies(clean, server)[0]).toBe(clean[0]);
  });

  it('tolerates missing arguments', () => {
    expect(markDirtyPolicies()).toEqual([]);
    expect(markDirtyPolicies([{ Group: 1 }])[0].isUpdated).toBe(true);
  });
});


describe('edit, save, refetch', () => {
  // The sequence the review called out, exercised through the pure functions the component
  // composes -- this repo's jest setup has no React renderer.
  const serverRow = (overrides = {}) => ({ ID: 'acl-1', Group: 1, View: true, Modify: false, ...overrides });

  it('goes clean once the server agrees, with no flag bookkeeping', () => {
    const server = [serverRow()];

    // 1. user turns Modify on
    const edited = markDirtyPolicies([{ ...serverRow(), Modify: true }], server);
    expect(edited[0].isUpdated).toBe(true);

    // 2. the save lands and the refetch reports the new value
    const afterRefetch = reconcileAclList([serverRow({ Modify: true })], edited);

    expect(afterRefetch[0].Modify).toBe(true);
    expect(afterRefetch[0].isUpdated).toBe(false);
  });

  it('stays dirty when the write did not land', () => {
    const server = [serverRow()];
    const edited = markDirtyPolicies([{ ...serverRow(), Modify: true }], server);

    // The refetch still shows the old value, so the edit is still outstanding and retryable.
    const afterRefetch = reconcileAclList([serverRow()], edited);

    expect(afterRefetch[0].Modify).toBe(true);
    expect(afterRefetch[0].isUpdated).toBe(true);
  });

  it('toggling to and fro leaves nothing to save', () => {
    const server = [serverRow()];
    const there = markDirtyPolicies([{ ...serverRow(), Modify: true }], server);
    const andBack = markDirtyPolicies([{ ...there[0], Modify: false }], server);

    expect(andBack.some((a) => a.isUpdated)).toBe(false);
    expect(isPolicyDirty(andBack[0], server[0])).toBe(false);
  });
});
