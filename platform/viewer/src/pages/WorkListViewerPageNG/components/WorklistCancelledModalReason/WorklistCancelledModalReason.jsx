import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { updateWorklist } from '../../../../api/worklist';

import styles from './WorklistCancelledModalReason.module.scss';


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
      toast.success('Status of worklists was updated successfully!');
      void queryClient.invalidateQueries({
        queryKey: ['worklist'],
      });

      setIsOpen(false);
    },
    onError: () => {
      toast.error('Failed to update worklists status');
    },
  });

  return (
    <ModalNG
      isOpen={isOpen}
      title="Add Reject Reason"
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
