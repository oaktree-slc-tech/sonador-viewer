import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import OHIF, { redux } from '@ohif/core';

import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { createWorklistRequest } from '../../../../../api/worklist';
import { getDisplayName } from '../../../../../lib/getDisplayName';
import { useGroupMembership, useGroupSearch } from '../../../../../queries/worklist';

import groupSearchStyles from '../../../../../styles/groupSearch.module.scss';
import styles from './CreateWorklistModal.module.scss';


export default function CreateWorklistModal({ isOpen, setIsOpen, studyInstanceUIDs }) {
  // Modal dialog which can be used to create worklist items

  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const [groupSearchTerm, setGroupSearchTerm] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [showGroupSearchResponse, setShowGroupSearchResponse] = useState(true);
  const { data: groupSearch = [] } = useGroupSearch(activeServer, groupSearchTerm);
  
  const handleGroupInputChange = (e) => {
    // Update group search term

    setShowGroupSearchResponse(true);
    setGroupSearchTerm(e.target.value);
  };

  const handleSelectGroup = (group) => {
    // Set currently selected group and update the input name to the group name

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
  const { mutate: createWorklistRequestMutate, isLoading: isLoadingCreateWorklistRequest } = useMutation({
    mutationFn: () => createWorklistRequest({
      server: activeServer, groupId: selectedGroup.id, userId: selectedMembership.id,
      State: 'Scheduled', StudyInstanceUID: studyInstanceUIDs,
    }),
    onSuccess: () => {
      setIsOpen(false);      
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

  const filteredGroupMembership = groupMembership && groupMembership.length
    && groupMembership.filter((member)=> {

      return membershipSearchTerm == ''
        || (member.first_name || '').includes(membershipSearchTerm)
        || (member.last_name || '').includes(membershipSearchTerm)
        || (member.email || '').includes(membershipSearchTerm)
        || (getDisplayName(member) || '').includes(membershipSearchTerm);
    });  

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
          <ul className={groupSearchStyles.dropdown}>
            {groupSearch.map((group) => (
              <li
                key={group.id}
                className={groupSearchStyles.dropdownItem}
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
          {showMembershipSearchResponse && filteredGroupMembership.length > 0&& (
            <ul className={groupSearchStyles.dropdown}>
              {filteredGroupMembership.map((member) => (
                <li
                  key={member.id}
                  className={groupSearchStyles.dropdownItem}
                  onClick={() => handleSelectMember(member)}
                >
                  {getDisplayName(member)}
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
