import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { updateWorklist } from '../../../../api/worklist';

import styles from './WorklistStatusChangeModal.module.scss';
import { uiNotificationService } from '@ohif/core';


export default function WorklistStatusChangeModal({
  isOpen, setIsOpen, status, worklistId, StudyInstanceUID, handleUpdateStore,
}) {
  // Modal shown for non-Cancelled status transitions. Captures an optional reviewer note for
  // every transition (stored as the linked Comment for the ReviewHistory entry). When the target
  // status is Completed it also captures an optional Performed Procedure description, sent as the
  // server-owned PerformedProcedure facet.

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const [comment, setComment] = useState('');
  const [performedDescription, setPerformedDescription] = useState('');

  const isCompletion = status === 'Completed';

  const buildProcedure = () => {
    // Performed Procedure is only captured on completion; empty input sends no Procedure block.

    if (!isCompletion || !performedDescription.trim()) {
      return undefined;
    }
    return { PerformedProcedure: { PerformedProcedureStepDescription: performedDescription.trim() } };
  };

  const queryClient = useQueryClient();
  const { mutate: updateWorklistMutate, isLoading: isLoadingUpdateMutate } = useMutation({
    mutationFn: async () => {
      return updateWorklist({
        server: activeServer,
        worklistId: worklistId,
        State: status,
        Comment: comment.trim() || undefined,
        Procedure: buildProcedure(),
        StudyInstanceUID: StudyInstanceUID,
      });
    },
    onSuccess: () => {
      handleUpdateStore(status);
      uiNotificationService.show({ title: 'Status of worklist was updated successfully!', type: 'success' });
      void queryClient.invalidateQueries({
        queryKey: ['worklist'],
      });
      setIsOpen(false);
    },
    onError: () => {
      uiNotificationService.show({ title: 'Failed to update worklist status', type: 'error' });
    },
  });

  return (
    <ModalNG
      isOpen={isOpen}
      title={isCompletion ? 'Complete Review' : `Update Status to ${status}`}
      onClose={() => setIsOpen(false)}
      classes={{ content: styles.modal }}
    >
      <label className={styles.label} htmlFor="status-change-note">Reviewer Note (optional)</label>
      <textarea
        id="status-change-note"
        className={styles.textarea}
        value={comment}
        rows={4}
        onChange={e => setComment(e.target.value)}
        placeholder="Add a note for this status change (optional)..."
      />

      {isCompletion && (
        <>
          <label className={styles.label} htmlFor="performed-procedure-description">
            Performed Procedure (optional)
          </label>
          <input
            id="performed-procedure-description"
            className={styles.input}
            type="text"
            value={performedDescription}
            onChange={e => setPerformedDescription(e.target.value)}
            placeholder="Describe the procedure performed..."
          />
        </>
      )}

      <div className={styles.buttons}>
        <button className={styles.cancel} onClick={() => setIsOpen(false)}>Cancel</button>
        <button className={styles.save} onClick={() => updateWorklistMutate()} disabled={isLoadingUpdateMutate}>
          {isLoadingUpdateMutate ? <BouncingLoader width={40} height={20} /> : 'Save'}
        </button>
      </div>
    </ModalNG>
  );
}
