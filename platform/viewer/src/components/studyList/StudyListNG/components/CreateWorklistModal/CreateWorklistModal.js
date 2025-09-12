import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { createWorklistRequest } from '../../../../../api/worklist';
import { getDisplayName } from '../../../../../lib/getDisplayName';
import { useGroupMembership, useGroupSearch } from '../../../../../queries/worklist';

import styles from './CreateWorklistModal.module.scss';

export default function CreateWorklistModal({ isOpen, setIsOpen, studyInstanceUIDs }) {
  const activeServer = useSelector((state) =>
    state.servers.servers.find((s) => s.active),
  );
  const [groupSearchTerm, setGroupSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showGroupSearchResponse, setShowGroupSearchResponse] = useState(true);
  const { data: groupSearch = [] } = useGroupSearch(activeServer, groupSearchTerm);
  const handleGroupInputChange = (e) => {
    setShowGroupSearchResponse(true);
    setGroupSearchTerm(e.target.value);
  };

  const handleSelectGroup = (group) => {
    setSelectedGroup(group);
    setGroupSearchTerm(group.name);
    setShowGroupSearchResponse(false);
    setShowMembershipSearchResponse(true);
  };

  // members
  const [membershipSearchTerm, setMembershipSearchTerm] = useState('');
  const [selectedMembership, setSelectedMembership] = useState(null);
  const [showMembershipSearchResponse, setShowMembershipSearchResponse] = useState(false);
  const { data: groupMembership = [] } = useGroupMembership({
    server: activeServer,
    enabled: !!selectedGroup,
    groupId: selectedGroup?.id,
    term: membershipSearchTerm,
  });
  const handleMemberInputChange = (e) => {
    setShowMembershipSearchResponse(true);
    setMembershipSearchTerm(e.target.value);
  };

  const handleSelectMember = (member) => {
    setSelectedMembership(member);
    setMembershipSearchTerm(getDisplayName(member));
    setShowMembershipSearchResponse(false);
  };

  // create worklist
  const navigate = useNavigate();

  const { mutate: createWorklistRequestMutate, isLoading: isLoadingCreateWorklistRequest } = useMutation({
    mutationFn: () => createWorklistRequest({
      server: activeServer, groupId: selectedGroup.id, userId: selectedMembership.id,
      State: 'Scheduled', StudyInstanceUID: studyInstanceUIDs,
    }),
    onSuccess: () => {
      setIsOpen(false);
      navigate('/worklist');
    },
    onError: () => {
      toast.error('Failed to create worklist request');
    },
  });

  const handleCreateWorklistRequest = (e) => {
    e.stopPropagation();
    createWorklistRequestMutate();
  };

  const errantModalClick = (e) => {
    // Prevent unintended click events from propagating to associated components
    
    e.preventDefault();
    e.stopPropagation();
  }

  return (
    <ModalNG
      isOpen={isOpen}
      title="Create Worklist item"
      onClose={(e) => {
        e.stopPropagation()
        return setIsOpen(false);
      }}
      classes={{ content: styles.modal }}
      onModalClick={errantModalClick}
    >
      {/* Group*/}
      <div className={styles.inputGroup}>
        <label htmlFor="group-search">Select Group</label>
        <input
          id="group-search"
          type="text"
          value={groupSearchTerm}
          onChange={handleGroupInputChange}
          onFocus={() => setShowGroupSearchResponse(true)}
          placeholder="Search for a group"
          className={styles.input}
        />
        {showGroupSearchResponse && groupSearch.length > 0 && (
          <ul className={styles.dropdown}>
            {groupSearch.map((group) => (
              <li
                key={group.id}
                className={styles.dropdownItem}
                onClick={() => handleSelectGroup(group)}
              >
                {group.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*Membership*/}
      {selectedGroup &&
        <div className={styles.inputGroup}>
          <label htmlFor="group-search">Select Member</label>
          <input
            id="group-search"
            type="text"
            value={membershipSearchTerm}
            onChange={handleMemberInputChange}
            onFocus={() => setShowMembershipSearchResponse(true)}
            placeholder="Search for a member"
            className={styles.input}
          />
          {showMembershipSearchResponse && groupMembership.length > 0 && (
            <ul className={styles.dropdown}>
              {groupMembership.map((memeber) => (
                <li
                  key={memeber.id}
                  className={styles.dropdownItem}
                  onClick={() => handleSelectMember(memeber)}
                >
                  {getDisplayName(memeber)}
                </li>
              ))}
            </ul>
          )}
        </div>
      }

      {selectedMembership &&
        <div className={styles.createButtonWrapper}>

          <button disabled={isLoadingCreateWorklistRequest} onClick={handleCreateWorklistRequest}
                  className={styles.createWorklist}>
            {isLoadingCreateWorklistRequest ? <BouncingLoader width={40} height={32} /> :
              'Create worklist request'
            }
          </button>
        </div>
      }
    </ModalNG>
  );
}
