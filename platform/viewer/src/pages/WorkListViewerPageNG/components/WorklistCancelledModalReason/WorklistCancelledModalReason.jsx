import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { updateWorklist } from '../../../../api/worklist';

import styles from './WorklistCancelledModalReason.module.scss';
import { uiNotificationService } from '@ohif/core';


export default function WorklistCancelledModalReason({ isOpen, setIsOpen,  selectedWorklists,handleUpdateStore }) {
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const [comment, setComment] = useState('');

  const queryClient = useQueryClient();
  const { mutate: updateWorklistMutate, isLoading: isLoadingUpdateMutate } = useMutation({
    mutationFn: async () => {
      await Promise.all(
        selectedWorklists.map(async (item) => {
          return updateWorklist({
            server: activeServer,
            worklistId: item.original.worklistId,
            State: 'Cancelled',
            Comment: comment,
            StudyInstanceUID: item.original.StudyInstanceUID.value,
          });
        }),
      );
    },
    onSuccess: () => {
      handleUpdateStore('Cancelled')
      uiNotificationService.show({ title: 'Status of worklists was updated successfully!', type: 'success' });
      void queryClient.invalidateQueries({
        queryKey: ['worklist'],
      });

      setIsOpen(false);
    },
    onError: () => {
      uiNotificationService.show({ title: 'Failed to update worklists status', type: 'error' });
    },
  });

  return (
    <ModalNG
      isOpen={isOpen}
      title="Add Reason for Cancellation"
      onClose={() => setIsOpen(false)}
      classes={{ content: styles.modal }}
    >
        <textarea
          className={styles.textarea}
          value={comment}
          rows={4}
          onChange={e => setComment(e.target.value)}
          placeholder="Add a comment (optional)..."
        />


      <div className={styles.buttons}>
        <button className={styles.cancel} onClick={() => setIsOpen(false)}>Cancel</button>
        <button className={styles.save} onClick={() => updateWorklistMutate()} disabled={isLoadingUpdateMutate}>
          {isLoadingUpdateMutate ? <BouncingLoader width={40} height={20} /> : 'Save'}
        </button>
      </div>
    </ModalNG>
  );
}
