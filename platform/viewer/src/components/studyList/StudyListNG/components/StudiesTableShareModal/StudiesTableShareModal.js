import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import _ from 'lodash';
import PropTypes from 'prop-types';

import { useDebounce } from '@ohif/ui';
import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import Loader from '@ohif/ui/src/components/Loader/Loader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import {
  createAclGroup,
  createAclUser,
  deleteAclGroupPermission,
  deleteAclUserPermission,
  getAclGroups,
  getAclUsers,
  searchAcl,
  updateAclGroup,
  updateAclUser,
} from '../../../../../api/share';
import useClickOutside from '../../../../../hooks/useClickOutside';

import { ReactComponent as GroupIcon } from './group.svg';
import { ReactComponent as TrashIcon } from './trash.svg';
import { ReactComponent as UserIcon } from './user.svg';

import styles from './StudiesTableShareModal.module.scss';

const permissions = [
  { label: 'View', id: 'View' },
  { label: 'Modify', id: 'Modify' },
  { label: 'Remove', id: 'Remove' },
  { label: 'Manage ACL', id: 'ACL' },
];

export default function StudiesTableShareModal({ setIsOpenedShareModal, isOpenedShareModal,  selectedStudy }) {
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const queryClient = useQueryClient();

  const { data: aclUsers, isLoading: aclUsersIsLoading } = useQuery({
    queryFn: () => getAclUsers(activeServer, selectedStudy.id),
    queryKey: ['aclUsers'],
  });
  const { mutateAsync: createUserAsync } = useMutation({
    mutationFn: async (user) => {
      if (!user.ID) {
        // User does not yet exist on the server, create and then update local copy with ID
        const _data = await createAclUser(activeServer, selectedStudy.id, user)
        createUserAsync({ User: user.User, ID: _data.ID });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclUsers']);
    },
  });
  const { mutateAsync: updateUserAsync } = useMutation({
    mutationFn: (user) => updateAclUser(activeServer, selectedStudy.id, user),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclUsers']);
    },
  });

  const { data: aclGroups, isLoading: aclGroupsIsLoading } = useQuery({
    queryFn: () => getAclGroups(activeServer, selectedStudy.id),
    queryKey: ['aclGroups'],
  });
  const { mutateAsync: createGroupAsync } = useMutation({
    mutationFn: async (group) => {
      if (!group.ID) {
        // Group does not yet exist on the server, create and then update local copy with ID
        const _data = await createAclGroup(activeServer, selectedStudy.id, group)
        createGroupAsync({ Group: group.Group, ID: _data.ID });
      }
    },
    onSuccess: async (_response ) => {
      await queryClient.invalidateQueries(['aclGroups']);
    },
  });
  const { mutateAsync: updateGroupAsync } = useMutation({
    mutationFn: (group) => updateAclGroup(activeServer, selectedStudy.id, group),
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclGroups']);
    },
  });
  const { mutate: mutateDeleteGroupPermission, isPending: isPendingDeleteGroupPermission } = useMutation({
    mutationFn: ({ permissionId }) => {
      deleteAclGroupPermission(activeServer, selectedStudy.id, permissionId);
    },
    onSuccess: async (_response, payload) => {
      await queryClient.invalidateQueries(['aclGroups']);
      setGroupsWithAccess((prevState) => prevState.filter((g) => g.Group !== payload.groupId));
    },
  });
  const { mutate: mutateDeleteUserPermission, isPending: isPendingDeleteUserPermision } = useMutation({
    mutationFn: ({ permissionId }) => {
      deleteAclUserPermission(activeServer, selectedStudy.id, permissionId);
    },
    onSuccess: async (_response, payload) => {
      await queryClient.invalidateQueries(['aclUsers']);
      setUsersWithAccess((prevState) => prevState.filter((u) => u.User !== payload.userId));
    },
  });

  const {
    mutate: searchUserGroup,
    data: foundUsersGroupsList,
    reset: resetFoundusersGroupList,
  } = useMutation({
    mutationFn: async (params) => {
      return await searchAcl(activeServer, params);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries(['aclUsers']);
    },
  });

  const [searchValue, setSearchValue] = useState('');
  const [showList, setShowList] = useState(false);
  const [usersWithAccess, setUsersWithAccess] = useState([]);
  const [groupsWithAccess, setGroupsWithAccess] = useState([]);

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
    const isUser = userGroup['result-type'] === 'user';
    const isExistUserInAclList = isUser && usersWithAccess.some(({ User }) => User === userGroup.id);
    const isExistGroupInAclList = !isUser && groupsWithAccess.some(({ Group }) => Group === userGroup.id);

    const dataToSet = {
      User: isUser ? userGroup.id : undefined,
      Group: isUser ? undefined : userGroup.id,
      View: false,
      Modify: false,
      Remove: false,
      // CommentView: false,
      ACL: false,
      first_name: userGroup.first_name,
      last_name: userGroup.last_name,
      email: userGroup.email,
      name: userGroup.name,
      'result-type': userGroup['result-type'],
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
    // Remove the selected access policy
    if ((isUser && isPendingDeleteUserPermision) || (!isUser && isPendingDeleteGroupPermission)) {
      return;
    }

    const user = usersWithAccess.find(({ User }) => User === userGroupId);
    const group = groupsWithAccess.find(({ Group }) => Group === userGroupId);
    const userHasAccess = !!user && !!aclUsers.find(({ User }) => User === userGroupId);
    const groupHasAccess = !!group && !!aclGroups.find(({ Group }) => Group === userGroupId);

    // Determine current state of the ACL policy
    if (isUser && !userHasAccess) {
      // User policy not yet pesisted
      setUsersWithAccess((prevState) => prevState.filter((u) => u.User !== userGroupId));
    } else if (isUser && userHasAccess) {
      // Delete remote user policy and remove user from list
      mutateDeleteUserPermission({ permissionId, userId: userGroupId });
    } else if (!isUser && !groupHasAccess) {
      // Group policy not yet persisted
      setGroupsWithAccess((prevState) => prevState.filter((g) => g.Group !== userGroupId));
    } else if (!isUser && groupHasAccess) {
      // Delete remote group policy and remove user from list
      mutateDeleteGroupPermission({ permissionId, groupId: userGroupId });
    }
  };

  const handleChangePermission = (permissionId, userId, isUser) => (event) => {
    // Update local state of the ACL policy after a change

    if (isUser) {
      setUsersWithAccess((prevState) => {
        return prevState.map((item) => {
          if (item.User !== userId) {
            return item;
          }

          return {
            ...item,
            [permissionId]: event.target.checked,
          };
        });
      });
    } else {
      setGroupsWithAccess((prevState) => {
        return prevState.map((item) => {
          if (item.Group !== userId) {
            return item;
          }

          return {
            ...item,
            [permissionId]: event.target.checked,
          };
        });
      });
    }
  };

  const handleSave = async (e) => {
    e.stopPropagation();
    const tasks = [];

    usersWithAccess.forEach((userWithAccess) => {
      const foundUser = aclUsers.find(({ User }) => User === userWithAccess.User);

      if (foundUser) {
        const isChanged =
          foundUser.View !== userWithAccess.View ||
          foundUser.Modify !== userWithAccess.Modify ||
          foundUser.Remove !== userWithAccess.Remove ||
          // foundUser.CommentView !== userWithAccess.CommentView ||
          foundUser.ACL !== userWithAccess.ACL;

        if (isChanged) {
          tasks.push(updateUserAsync(userWithAccess));
        }
      } else {
        const payload = _.pick(userWithAccess, ['User', ...permissions.map((p) => p.id)]);
        tasks.push(createUserAsync(payload));
      }
    });

    groupsWithAccess.forEach((groupWithAccess) => {
      const foundGroup = aclGroups.find(({ Group }) => Group === groupWithAccess.Group);

      if (foundGroup) {
        const isChanged =
          foundGroup.View !== groupWithAccess.View ||
          foundGroup.Modify !== groupWithAccess.Modify ||
          foundGroup.Remove !== groupWithAccess.Remove ||
          foundGroup.CommentView !== groupWithAccess.CommentView ||
          foundGroup.ACL !== groupWithAccess.ACL;

        if (isChanged) {
          tasks.push(updateGroupAsync(groupWithAccess));
        }
      } else {
        const payload = _.pick(groupWithAccess, ['Group', ...permissions.map((p) => p.id)]);
        tasks.push(createGroupAsync(payload));
      }
    });

    // Wait for all tasks to settle
    const results = await Promise.allSettled(tasks);

    const hasErrors = results.some((res) => res.status === 'rejected');

    if (hasErrors) {
      toast.error('Some access changes failed to save.');
    } else {
      toast.success('Access control changes saved successfully!');
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

  // set default users which have access changed once
  useEffect(() => {
    if (aclUsers) {
      setUsersWithAccess(aclUsers);
    }
  }, [aclUsers]);

  // set default groups which have access changed once
  useEffect(() => {
    if (aclGroups) {
      setGroupsWithAccess(aclGroups);
    }
  }, [aclGroups]);

  const errantModalClick = (e) => {
    // Prevent unintended click events from propagating to associated components
    
    e.preventDefault();
    e.stopPropagation();
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
                  <div>
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
                                    handleDeleteUserOrGroup(
                                      acl.User || acl.Group,
                                      acl['result-type'] === 'user' || (acl.user && !_.isUndefined(acl.user.id)),
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
        <button className={styles.saveBtn} onClick={handleSave}>
          Save
        </button>
      </div>
    </ModalNG>
  );
}

StudiesTableShareModal.propTypes = {
  isOpenedShareModal: PropTypes.bool.isRequired,
  setIsOpenedShareModal: PropTypes.func.isRequired,
  selectedStudy: PropTypes.object,
};
