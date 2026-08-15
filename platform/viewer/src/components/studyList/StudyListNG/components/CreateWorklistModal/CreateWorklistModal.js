import React from 'react';
import { useSelector } from 'react-redux';
import { useMutation } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import { redux, uiNotificationService } from '@ohif/core';
import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { createWorklistRequest } from '../../../../../api/worklist';
import useWorklistRequestForm from '../worklistRequest/useWorklistRequestForm';
import WorklistRequestFields from '../worklistRequest/WorklistRequestFields';
import { INITIAL_REVIEW_STATE } from '../worklistRequest/worklistRequestForm';

import styles from './CreateWorklistModal.module.scss';


export default function CreateWorklistModal({ isOpen, setIsOpen, studyInstanceUIDs }) {
  // Modal dialog which can be used to create worklist items for a single study.
  //
  // The form itself -- group, reviewer, reason, requested procedure, and the rules for changing them
  // -- is shared with the bulk dialog (WorklistRequestFields / useWorklistRequestForm). Keeping a
  // second copy here is what let the two drift: this dialog filtered its membership list
  // case-sensitively, gave both its inputs the same element id so its two labels pointed at the same
  // control, and left a chosen group in place when the user typed over it.

  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const { form, fields, canSubmit, procedure } = useWorklistRequestForm(activeServer);

  const { mutate: createWorklistRequestMutate, isLoading } = useMutation({
    mutationFn: () => createWorklistRequest({
      server: activeServer,
      groupId: form.group.id,
      userId: form.member.id,
      State: INITIAL_REVIEW_STATE,
      StudyInstanceUID: studyInstanceUIDs,
      Procedure: procedure,
    }),
    onSuccess: () => {
      setIsOpen(false);
    },
    onError: () => {
      uiNotificationService.show({ title: 'Failed to create worklist request', type: 'error' });
    },
  });

  const errantModalClick = (e) => {
    // Prevent unintended click events from propagating to associated components
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <ModalNG
      isOpen={isOpen}
      title="Create Worklist item"
      onClose={(e) => {
        e.stopPropagation();
        return setIsOpen(false);
      }}
      classes={{ content: styles.modal }}
      onModalClick={errantModalClick}
    >
      <WorklistRequestFields fields={fields} idPrefix="create-worklist" />

      {/* Gated on `canSubmit`, which reads the stored group and reviewer rather than the text in the
          search fields -- text that merely looks like a group name is not a group. */}
      {canSubmit && (
        <div className={styles.createButtonWrapper}>
          <button
            type="button"
            disabled={isLoading}
            onClick={(e) => {
              e.stopPropagation();
              createWorklistRequestMutate();
            }}
            className={styles.createWorklist}
          >
            {isLoading ? <BouncingLoader width={40} height={32} /> : 'Create worklist request'}
          </button>
        </div>
      )}
    </ModalNG>
  );
}


CreateWorklistModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  setIsOpen: PropTypes.func.isRequired,
  /** StudyInstanceUID of the study the review is being requested for. */
  studyInstanceUIDs: PropTypes.string,
};
