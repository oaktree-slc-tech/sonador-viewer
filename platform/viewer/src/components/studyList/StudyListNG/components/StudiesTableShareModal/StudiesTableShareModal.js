import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import _ from 'lodash';
import PropTypes from 'prop-types';

import { uiNotificationService } from '@ohif/core';
import { useDebounce } from '@ohif/ui';
import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import Loader from '@ohif/ui/src/components/Loader/Loader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import {
  deleteAclGroupPermission,
  deleteAclUserPermission,
  getAclGroups,
  getAclUsers,
  searchAcl,
  updateAclGroup,
  updateAclUser,
  upsertAclGroup,
  upsertAclUser,
} from '../../../../../api/share';
import useClickOutside from '../../../../../hooks/useClickOutside';
import { emptyPermissions,PERMISSION_IDS } from '../BulkShareModal/permissionFields';

import { isPolicyDirty, markDirtyPolicies, reconcileAclList } from './aclReconcile';
import { describeAclSubject as _labelFor } from './aclSubject';
import { ReactComponent as GroupIcon } from './group.svg';
import { ReactComponent as TrashIcon } from './trash.svg';
import { ReactComponent as UserIcon } from './user.svg';

import styles from './StudiesTableShareModal.module.scss';

// The canonical list, shared with the bulk dialog rather than repeated here. It previously held a
// private copy of four, which is how this dialog came to be unable to edit the comment permissions
// the gateway stores -- and how a bulk write could silently preserve them.
const permissions = PERMISSION_IDS;


const _notifyRevoked = (label) => {
  // Revoking access had no feedback at all: the row disappeared (when it worked) and nothing said
  // the server had been changed. Logged, so the change is auditable in the Issues list alongside
  // the study and series removals.
  uiNotificationService.show({
    title: 'Access revoked',
    message: `${label} no longer has access to this study.`,
    type: 'success',
    log: true,
  });
};


const _notifyRevokeFailed = (label, err, studyInstanceUID) => {
  // Sticky: a permission the user believes they revoked but did not is a disclosure they cannot
  // see. Carries the request details so the failure is diagnosable from the Issues list.
  uiNotificationService.show({
    title: 'Access not revoked',
    message: `${label} still has access to this study. The change was not saved.`,
    type: 'error',
    autoClose: false,
    studyInstanceUID,
    details: { url: err?.url, status: err?.status, body: err?.body },
    error: err,
  });
};

export default function StudiesTableShareModal({ setIsOpenedShareModal, isOpenedShareModal,  selectedStudy }) {
  // ACL dialog for updating the share permissions for a study

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const queryClient = useQueryClient();

  // For a study-list row, react-table's row id IS the StudyInstanceUID (see
  // studyRowDescriptors._getStudyInstanceUID).
  const studyId = selectedStudy?.id;

  const { data: aclUsers, isLoading: aclUsersIsLoading } = useQuery({
    queryFn: () => getAclUsers(activeServer, studyId),
    // Keyed by study. Without the id every study shared the one cache entry, so opening the dialog
    // on a second study showed the first study's policies until the refetch landed.
    queryKey: ['aclUsers', studyId],
  });
  
  // upsert rather than create: the gateway rejects a POST for a policy that already exists with a
  // 400 'unique' instead of updating it, and the list this dialog decides create-vs-update from can
  // be stale by the time Save is pressed (another tab, another user, or simply a policy added and
  // saved twice in one sitting). upsertAclUser retries such a POST as a PUT against the ID the
  // gateway returns. This also used to re-enter the mutation with the new ID purely to reach its
  // own onSuccess, which just invalidated the query a second time.
  const { mutateAsync: createUserAsync } = useMutation({
    mutationFn: (user) => upsertAclUser(activeServer, studyId, user),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclUsers', studyId]);
    },
  });

  const { mutateAsync: updateUserAsync } = useMutation({
    mutationFn: (user) => updateAclUser(activeServer, studyId, user),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclUsers', studyId]);
    },
  });

  const { data: aclGroups, isLoading: aclGroupsIsLoading } = useQuery({
    queryFn: () => getAclGroups(activeServer, studyId),
    queryKey: ['aclGroups', studyId],
  });
  
  const { mutateAsync: createGroupAsync } = useMutation({
    mutationFn: (group) => upsertAclGroup(activeServer, studyId, group),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclGroups', studyId]);
    },
  });

  const { mutateAsync: updateGroupAsync } = useMutation({
    mutationFn: (group) => updateAclGroup(activeServer, studyId, group),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclGroups', studyId]);
    },
  });
  
  // Revoking a policy. Three things were wrong here and they compounded, which is why the first
  // revoke on a dialog looked fine and the second did not:
  //
  //   1. the mutationFn called deleteAcl*Permission WITHOUT returning its promise, so the mutation
  //      resolved immediately and onSuccess invalidated the query while the DELETE was still in
  //      flight. The refetch raced the delete and frequently won, returning the policy that was
  //      about to be removed;
  //   2. onSuccess then spliced the row out of local state optimistically, and the effect that
  //      mirrors the query result back into that same state put it straight back;
  //   3. the re-entrancy guard read `isPending`, which does not exist on a react-query v4 mutation
  //      result -- it is `isLoading` -- so the guard was permanently undefined and never blocked
  //      the second click on a row that had not visibly gone away.
  //
  // Now: the promise is returned, the refetch is therefore ordered after the DELETE, and the
  // reconciler is the only thing that removes the row. api/share.js treats a 404 as success, so
  // the repeat click that used to error is a no-op.
  const { mutate: mutateDeleteGroupPermission, isLoading: isDeletingGroupPermission } = useMutation({
    mutationFn: ({ permissionId }) => deleteAclGroupPermission(activeServer, studyId, permissionId),
    onSuccess: async (_response, payload) => {
      _notifyRevoked(payload.label);
      await queryClient.invalidateQueries(['aclGroups', studyId]);
    },
    onError: (err, payload) => _notifyRevokeFailed(payload.label, err, studyId),
  });

  const { mutate: mutateDeleteUserPermission, isLoading: isDeletingUserPermission } = useMutation({
    mutationFn: ({ permissionId }) => deleteAclUserPermission(activeServer, studyId, permissionId),
    onSuccess: async (_response, payload) => {
      _notifyRevoked(payload.label);
      await queryClient.invalidateQueries(['aclUsers', studyId]);
    },
    onError: (err, payload) => _notifyRevokeFailed(payload.label, err, studyId),
  });

  const {
    mutate: searchUserGroup,
    data: foundUsersGroupsList,
    reset: resetFoundusersGroupList,
  } = useMutation({
    mutationFn: async (params) => {
      return await searchAcl(activeServer, params);
    },
    // No invalidation: searching the directory does not change this study's policies, and the
    // refetch it used to fire on every debounced keystroke was more churn for the reconciler to
    // absorb. (It also used the un-keyed ['aclUsers'], so it invalidated every study's entry.)
  });

  const [searchValue, setSearchValue] = useState('');
  const [showList, setShowList] = useState(false);

  // Users and groups
  const [usersWithAccess, setUsersWithAccess] = useState([]);
  const [groupsWithAccess, setGroupsWithAccess] = useState([]);

   // Save / Cancel state
  const [changesPending, setChangesPending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  useEffect(() => {
    // Toggle changes pending based on the state of the user / group ACL lists
    
    const _pending_user = (usersWithAccess && usersWithAccess.length > 0
      && !_.every(usersWithAccess, (uAcl) => !uAcl.isUpdated)) ?? false;
    const _pending_group = (groupsWithAccess && groupsWithAccess.length > 0
      && !_.every(groupsWithAccess, (gAcl) => !gAcl.isUpdated)) ?? false;
    const _pending = (_pending_user || _pending_group) ?? false;

    setChangesPending(_pending);
  }, [usersWithAccess, groupsWithAccess]);

  const autocompleteRef = useRef(null);

  const callback = useCallback(() => setShowList(false), [setShowList]);
  useClickOutside(autocompleteRef, callback);
  const debouncedSearch = useDebounce(searchValue, 300);

  const handleChangeSearch = ({ target }) => {
    resetFoundusersGroupList();
    setSearchValue(target.value);

    if (target.value.length > 0) {
      setShowList(true);
    } else {
      setShowList(false);
    }
  };

  const handleSelectUserOrGroup = (userGroup) => {
    // Create a placeholder policy for user/group search result after it has been
    // selected from the search dropdown.

    const isUser = userGroup['result-type'] === 'user';
    const isExistUserInAclList = isUser && usersWithAccess.some(({ User }) => User === userGroup.id);
    const isExistGroupInAclList = !isUser && groupsWithAccess.some(({ Group }) => Group === userGroup.id);

    const dataToSet = {
      User: isUser ? userGroup.id : undefined,
      Group: isUser ? undefined : userGroup.id,
      // Every permission starts explicitly false, from the canonical list. These were four
      // hardcoded fields, so a permission added to the list would render as an unchecked box backed
      // by `undefined` and never be sent.
      ...emptyPermissions(),
      first_name: userGroup.first_name,
      last_name: userGroup.last_name,
      email: userGroup.email,
      name: userGroup.name,
      'result-type': userGroup['result-type'],
      isUpdated: true,
    };
    if (isUser && !isExistUserInAclList) {
      setUsersWithAccess((prevState) => [...prevState, dataToSet]);
    }

    if (!isUser && !isExistGroupInAclList) {
      setGroupsWithAccess((prevState) => [...prevState, dataToSet]);
    }

    setSearchValue('');
    setShowList(false);
  };

  const handleDeleteUserOrGroup = (userGroupId, isUser, permissionId) => {
    // Remove the selected access policy.
    //
    // `isLoading`, not `isPending` -- see the mutations above. This is what actually stops a second
    // click landing on a row whose revoke is still in flight.
    if ((isUser && isDeletingUserPermission) || (!isUser && isDeletingGroupPermission)) {
      return;
    }

    const user = usersWithAccess.find(({ User }) => User === userGroupId);
    const group = groupsWithAccess.find(({ Group }) => Group === userGroupId);

    // Persisted-ness is decided by the policy's own ID rather than by searching the query data.
    // The query arrays are undefined until the first fetch resolves and `.find` on them threw, and
    // a policy carrying an ID is by definition one the server issued.
    const userHasAccess = !!user && !!permissionId;
    const groupHasAccess = !!group && !!permissionId;

    // Determine current state of the ACL policy
    if (isUser && !userHasAccess) {

      // User policy not yet persisted
      setUsersWithAccess((prevState) => prevState.filter((u) => u.User !== userGroupId));
    } else if (isUser && userHasAccess) {

      // Delete remote user policy; the refetch drops it from the list
      mutateDeleteUserPermission({ permissionId, userId: userGroupId, label: _labelFor(user) });
    } else if (!isUser && !groupHasAccess) {

      // Group policy not yet persisted
      setGroupsWithAccess((prevState) => prevState.filter((g) => g.Group !== userGroupId));
    } else if (!isUser && groupHasAccess) {

      // Delete remote group policy; the refetch drops it from the list
      mutateDeleteGroupPermission({ permissionId, groupId: userGroupId, label: _labelFor(group) });
    }
  };

  const handleChangePermission = (permissionId, userId, isUser) => (event) => {
    // Apply the toggle, then RE-DERIVE which rows differ from the server.
    //
    // This used to assert `isUpdated: true` on every toggle and never revisit it, so turning a
    // permission off and back on left the row permanently dirty: Save stayed offered, and pressing
    // it produced no write at all because the save path independently compared fields and found
    // nothing changed. markDirtyPolicies makes the flag a function of the data rather than a record
    // of having been touched, so the two can no longer disagree.
    const checked = event.target.checked;
    const applyToggle = (list, idField, server) =>
      markDirtyPolicies(
        list.map((item) => (item[idField] === userId ? { ...item, [permissionId]: checked } : item)),
        server
      );

    if (isUser) {
      setUsersWithAccess((prevState) => applyToggle(prevState, 'User', aclUsers));
    } else {
      setGroupsWithAccess((prevState) => applyToggle(prevState, 'Group', aclGroups));
    }
  };

  const handleSave = async (e) => {
    e.stopPropagation();

    // Synchronous, before the first await: `isSaving` is state and lands a render too late to stop
    // a second click, which would re-issue every write in the batch.
    if (savingRef.current) {
      return;
    }

    savingRef.current = true;
    setIsSaving(true);

    // Each task is paired with the policy it belongs to, so the outcome can be attributed back to a
    // row. Previously the promises went into a bare array and only the aggregate was inspected,
    // which left nothing to clear the dirty flags with.
    // Which rows to write is decided by the SAME predicate that decides whether Save is offered.
    // They were separate before, and could disagree.
    const tasks = [];

    usersWithAccess.forEach((userWithAccess) => {
      const foundUser = (aclUsers || []).find(({ User }) => User === userWithAccess.User);

      if (!isPolicyDirty(userWithAccess, foundUser)) {
        return;
      }

      if (foundUser) {
        tasks.push({ run: () => updateUserAsync(userWithAccess) });
      } else {
        const payload = _.pick(userWithAccess, ['User', ...permissions.map((p) => p.id)]);
        tasks.push({ run: () => createUserAsync(payload) });
      }
    });

    groupsWithAccess.forEach((groupWithAccess) => {
      const foundGroup = (aclGroups || []).find(({ Group }) => Group === groupWithAccess.Group);

      if (!isPolicyDirty(groupWithAccess, foundGroup)) {
        return;
      }

      if (foundGroup) {
        tasks.push({ run: () => updateGroupAsync(groupWithAccess) });
      } else {
        const payload = _.pick(groupWithAccess, ['Group', ...permissions.map((p) => p.id)]);
        tasks.push({ run: () => createGroupAsync(payload) });
      }
    });

    // Nothing to write. Reachable only if the flags and the predicate have drifted, which they no
    // longer can -- but reporting "saved successfully" for zero writes is exactly what the old
    // toggle-and-restore bug did, so it is refused explicitly rather than left to be re-derived.
    if (!tasks.length) {
      setUsersWithAccess((list) => markDirtyPolicies(list, aclUsers));
      setGroupsWithAccess((list) => markDirtyPolicies(list, aclGroups));
      savingRef.current = false;
      setIsSaving(false);
      return;
    }

    try {
      const results = await Promise.allSettled(tasks.map(({ run }) => run()));

      // No flag bookkeeping here. Each mutation awaits its own cache invalidation, so by the time
      // these settle the query data is fresh; the effect that reconciles it re-derives dirtiness
      // from the server. A row that saved goes clean because the server now agrees with it, and a
      // row that failed stays dirty because it does not.
      const failed = results.filter((res) => res.status === 'rejected').length;

      if (failed) {
        uiNotificationService.show({
          title: `${failed} of ${results.length} access changes failed to save.`,
          message: 'The changes that did not save are still shown as pending.',
          type: 'error',
          autoClose: false,
          studyInstanceUID: studyId,
        });
      } else {
        uiNotificationService.show({
          title: 'Access control changes saved successfully!',
          type: 'success',
          log: true,
        });
      }
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };


  const tables = [
    { tableName: 'users', list: usersWithAccess },
    { tableName: 'groups', list: groupsWithAccess },
  ];

  useEffect(() => {
    if (debouncedSearch) {
      searchUserGroup({ term: debouncedSearch });
    }
  }, [debouncedSearch]);

  // Fold the server's policies into the editable copy on screen. Previously these effects assigned
  // the query result wholesale, which discarded unsaved checkbox edits and -- because a revoke
  // splices the row out locally and then refetches -- resurrected policies the user had just
  // revoked. reconcileAclList lets the server decide membership and the local copy keep its edits.
  useEffect(() => {
    if (aclUsers) {
      setUsersWithAccess((prev) => reconcileAclList(aclUsers, prev));
    }
  }, [aclUsers]);

  useEffect(() => {
    if (aclGroups) {
      setGroupsWithAccess((prev) => reconcileAclList(aclGroups, prev));
    }
  }, [aclGroups]);

  const errantModalClick = (e) => {
    // Prevent unintended click events from propagating to associated components
    
    e.preventDefault();
    e.stopPropagation();
  }


  const handleCancel = () => {
    // Discard pending edits and fall back to what the server reports. Defaulted, because the query
    // data is undefined until the first fetch resolves and assigning that made `list.length` throw
    // on the next render.

    setUsersWithAccess(aclUsers || []);
    setGroupsWithAccess(aclGroups || []);
  }

  return (
    <ModalNG
      isOpen={isOpenedShareModal}
      title="Share Access"
      onClose={() => {
        setIsOpenedShareModal(false);
      }}
      classes={{ content: styles.modal }}
      onModalClick={errantModalClick}
    >
      <div className={styles.autoComplete} ref={autocompleteRef}>
        <input
          type="search"
          placeholder="Add users or groups"
          value={searchValue}
          onChange={handleChangeSearch}
          className={styles.autoCompleteInput}
        />
        {showList && foundUsersGroupsList?.length > 0 && (
          <div className={styles.autoCompleteList}>
            {foundUsersGroupsList.map((result) => {
              return (
                <button
                  key={result['result-type'] + result.id}
                  className={styles.autoCompleteListItem}
                  onClick={() => handleSelectUserOrGroup(result)}
                >
                  {result['result-type'] === 'user' ? (
                    <UserIcon className={styles.userIcon} />
                  ) : (
                    <GroupIcon className={styles.groupIcon} />
                  )}
                  {(result.username || result.name) && <span>{result.username || result.name}</span>}
                  {(result.label_user || result.label_group) && (
                    <span className={styles.userGroupLabel}>{result.label_user || result.label_group}</span>
                  )}
                  {result.email && <span className={styles.userEmail}>{result.email}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {aclUsersIsLoading || aclGroupsIsLoading ? (
        <div className={styles.loaderContainer}>
          <Loader />
        </div>
      ) : (
        <>
          {tables.map(({ tableName, list }) => {
            if (list.length) {
              return (
                <div className={styles.blockWithAccess} key={tableName}>
                  <div className={styles.blockWithAccessLeft}>
                    <p>{tableName === 'users' ? 'Users' : 'Groups'} with access:</p>
                    {list.map((acl) => {
                      if (tableName === 'groups') {
                        return (
                          <div key={acl.ID || 'group-' + acl.Group} className={styles.aclPolicy}>
                            <div className={styles.aclGroupContainer}>
                              <div className={styles.avatarGroup}>
                                <GroupIcon className={styles.groupIcon} />
                              </div>
                              <p className={styles.groupName}>{acl.name}</p>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={acl.ID || 'user-' + acl.User} className={styles.aclPolicy}>
                          <div className={styles.aclUserContainer}>
                            <div className={styles.avatar}>
                              <p className={styles.avatarName}>
                                {acl.first_name?.slice(0, 1)?.toUpperCase()}
                                {acl.last_name?.slice(0, 1)?.toUpperCase()}
                              </p>
                            </div>
                            <div>
                              <p className={styles.userFirstLastName}>
                                {acl.first_name} {acl.last_name}
                              </p>
                              <p className={styles.userEmail}>{acl.email}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Scrolls within itself: six permission columns plus the revoke control is
                      wider than four, and the dialog must not push past the viewport. */}
                  <div className={styles.tableScroll}>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          {permissions.map(({ id, label }) => {
                            return <th key={id}>{label}</th>;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {list.map((acl) => {
                          return (
                            <tr key={acl.User || acl.Group}>
                              {permissions.map(({ id }) => {
                                return (
                                  <td align="center" key={id}>
                                    <CheckboxNG
                                      onChange={handleChangePermission(
                                        id,
                                        acl.User || acl.Group,
                                        tableName === 'users'
                                      )}
                                      checked={acl[id] ?? false}
                                      classes={{ label: styles.checkbox, checkmark: styles.checkmark }}
                                    />
                                  </td>
                                );
                              })}
                              <td>
                                <TrashIcon
                                  onClick={() => {
                                    // Which table this row is in is the authoritative answer to
                                    // "user or group?" -- the previous sniff at `result-type` and
                                    // `acl.user.id` disagreed with it for policies loaded from the
                                    // server, and `acl.User || acl.Group` silently resolved a user
                                    // whose id is 0 to the group branch.
                                    handleDeleteUserOrGroup(
                                      tableName === 'users' ? acl.User : acl.Group,
                                      tableName === 'users',
                                      acl.ID
                                    );
                                  }}
                                  className={styles.trashIcon}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }

            return null;
          })}
        </>
      )}
      <div className={styles.bottom}>
        {changesPending && (
          <>
          <button className={styles.cancelBtn} disabled={isSaving} onClick={handleCancel}>
            Cancel
          </button>
          {/* Disabled while the batch is in flight so a second click cannot re-issue writes that
              are already on their way. */}
          <button className={styles.saveBtn} disabled={isSaving} onClick={handleSave}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          </>
        )}
      </div>
    </ModalNG>
  );
}

StudiesTableShareModal.propTypes = {
  isOpenedShareModal: PropTypes.bool.isRequired,
  setIsOpenedShareModal: PropTypes.func.isRequired,
  selectedStudy: PropTypes.object,
};
