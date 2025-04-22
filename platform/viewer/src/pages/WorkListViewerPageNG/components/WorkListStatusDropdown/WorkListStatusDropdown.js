import React, { useCallback, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useSelector } from 'react-redux';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import classNames from 'classnames';

import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import { ReactComponent as CaretIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { ReactComponent as UnreadIcon } from '@ohif/ui/src/elements/Svg/svgs/circle.svg';
// import unreadIcon from '@ohif/ui/src/elements/Svg/svgs/circle.svg';
import { ReactComponent as ApprovedIcon } from '@ohif/ui/src/elements/Svg/svgs/circleCheckmark.svg';
// import approvedIcon from '@ohif/ui/src/elements/Svg/svgs/circleCheckmark.svg';
import { ReactComponent as RejectedIcon } from '@ohif/ui/src/elements/Svg/svgs/fullCircleClose.svg';
// import rejectedIcon from '@ohif/ui/src/elements/Svg/svgs/fullCircleClose.svg';
import { ReactComponent as ReviewedIcon } from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';

import { updateWorklist } from '../../../../api/worklist';
// import reviewedIcon from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';
import useClickOutside from '../../../../hooks/useClickOutside';
import { useWorkListStore } from '../../../../store/useWorkListStore';
import WorklistCancelledModalReason from '../WorklistCancelledModalReason/WorklistCancelledModalReason';

import styles from './WorkListStatusDropdown.module.scss';

const statuses = [
  { label: 'Scheduled', type: 'Scheduled', icon: (fill = '#BEBEBF') => <UnreadIcon fill={fill} /> },
  { label: 'In-progress', type: 'In-progress', icon: (fill = '#2E46E9') => <ReviewedIcon fill={fill} /> },
  { label: 'Completed', type: 'Completed', icon: (fill = '#58BC82') => <ApprovedIcon fill={fill} /> },
  { label: 'Cancelled', type: 'Cancelled', icon: (fill = '#FF423B') => <RejectedIcon fill={fill} /> },
];

export default function WorkListStatusDropdown({ currentStatus, worklistId, StudyInstanceUID, selectedStudy }) {
  const { workListSelectedStudies, setWorkListSelectedStudies } = useWorkListStore();
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  const [isOpen, setIsOpen] = useState(false);
  const initialStatusOption = statuses.find((stat) => stat.type === currentStatus);
  const [selectedStatus, setSelectedStatus] = useState(initialStatusOption ?? statuses[0]);
  const [showCancellationReasonModal, setShowCancellationReasonModal] = useState(false);

  const ref = useRef(null);

  const handleUpdateStore = (status)=>{
    const withNewStatusInWorklist = workListSelectedStudies.map(worklistItem => {
      if (worklistItem.original.worklistId === worklistId) {
        return {
          ...worklistItem,
          original: {
            ...worklistItem.original,
            Status: { ...worklistItem.original.Status, value: status },
          },
        };
      }
      return worklistItem;
    });
    setWorkListSelectedStudies(withNewStatusInWorklist);
    const newStatusOption = statuses.find((stat) => stat.type === status);
    setSelectedStatus(newStatusOption);
  }
  const queryClient = useQueryClient();
  const { mutate: updateWorklistMutate, isLoading: isLoadingUpdateMutate } = useMutation({
    mutationFn: async (selectedStatus) => {
      return updateWorklist({
        server: activeServer,
        worklistId: worklistId,
        State: selectedStatus,
        StudyInstanceUID: StudyInstanceUID,
      });
    },
    onSuccess: (_response, status) => {
      handleUpdateStore(status)
      toast.success('Status of worklist was updated successfully!');
      void queryClient.invalidateQueries({
        queryKey: ['worklist'],
      });
    },
    onError: () => {
      toast.error('Failed to update worklist status');
    },
  });

  const callback = useCallback(() => setIsOpen(false), []);

  useClickOutside(ref, callback);

  const handleSelectStatus = (status) => {
    if (status.type === 'Cancelled') {
      setShowCancellationReasonModal(true);
    } else {
      updateWorklistMutate(status.type);
      setIsOpen(false);
    }
  };

  return (
    <>
      <div ref={ref} className={styles.container}>
        <button
          className={classNames(styles.selectedStatus, {
            [styles.unread]: selectedStatus.type === 'Scheduled',
            [styles.reviewed]: selectedStatus.type === 'In-progress',
            [styles.approved]: selectedStatus.type === 'Completed',
            [styles.rejected]: selectedStatus.type === 'Canceled',
          })}
          disabled={isLoadingUpdateMutate}
          onClick={() => setIsOpen((prevState) => !prevState)}
        >
          {isLoadingUpdateMutate ?
            <BouncingLoader width={40} height={32} />
            : <>
              {selectedStatus.icon('#FFFFFF')}
              <p className={styles.statusLabel}>{selectedStatus.label}</p>
            </>
          }
          <CaretIcon
            className={classNames(styles.caret, {
              [styles.openCaret]: isOpen,
            })}
          />
        </button>
        {isOpen && (
          <div className={styles.statusList}>
            {statuses.map((status) => {
              return (
                <button
                  disabled={isLoadingUpdateMutate} key={status.type} className={styles.statusItem}
                  onClick={() => handleSelectStatus(status)}>
                  {status.icon()}
                  {isLoadingUpdateMutate ? <BouncingLoader width={40} height={32} />
                    : <p className={classNames(styles.statusItemLabel, styles[status.type])}>{status.label}</p>
                  }

                </button>
              );
            })}
          </div>
        )}
      </div>

      {showCancellationReasonModal && (
        <WorklistCancelledModalReason
          setIsOpen={setShowCancellationReasonModal}
          isOpen={showCancellationReasonModal}
          selectedWorklists={[selectedStudy]}
          handleUpdateStore={handleUpdateStore}
        />
      )}
    </>
  );
}
