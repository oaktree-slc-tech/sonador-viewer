import React, { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Select } from '@ohif/ui';
import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { updateWorklist } from '../../../../../../api/worklist';

import styles from './UpdateWorklistModal.module.scss';

const WORKLIST_STATUS_OPTIONS = [
  {
    key: 'Scheduled',
    value: 'Scheduled',
  },
  {
    key: 'In-progress',
    value: 'In-progress',
  },
  {
    key: 'Completed',
    value: 'Completed',
  },
  {
    key: 'Cancelled',
    value: 'Cancelled',
  },
];

export default function UpdateWorklistModal({ isOpen, setIsOpen, selectedWorklists }) {
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const [selectedStatus, setSelectedStatus] = useState(WORKLIST_STATUS_OPTIONS[0].value);
  const [comment, setComment] = useState('');

  const queryClient = useQueryClient();
  const { mutate: updateWorklistMutate, isLoading: isLoadingUpdateMutate } = useMutation({
    mutationFn: async () => {
      await Promise.all(
        selectedWorklists.map(async (item) => {
          return updateWorklist({
            server: activeServer,
            worklistId: item.original.worklistId,
            State: selectedStatus,
            Comment: comment,
            StudyInstanceUID: item.original.StudyInstanceUID.value,
          });
        }),
      );
    },
    onSuccess: () => {
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
      title="Change Status"
      onClose={() => setIsOpen(false)}
      classes={{ content: styles.modal }}
    >
      <div className={styles.topRow}>
        <span>Set status of {selectedWorklists.length} studies to:</span>
        <Select
          value={selectedStatus}
          data-cy="file-type"
          onChange={(status) => {
            setSelectedStatus(status);
          }}
          options={WORKLIST_STATUS_OPTIONS}
        />
      </div>
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
