import React, { useCallback, useRef, useState } from 'react';
import classNames from 'classnames';

import { ReactComponent as CaretIcon } from '@ohif/ui/src/elements/Svg/svgs/caret-down.svg';
import { ReactComponent as UnreadIcon } from '@ohif/ui/src/elements/Svg/svgs/circle.svg';
// import unreadIcon from '@ohif/ui/src/elements/Svg/svgs/circle.svg';
import { ReactComponent as ApprovedIcon } from '@ohif/ui/src/elements/Svg/svgs/circleCheckmark.svg';
// import approvedIcon from '@ohif/ui/src/elements/Svg/svgs/circleCheckmark.svg';
import { ReactComponent as RejectedIcon } from '@ohif/ui/src/elements/Svg/svgs/fullCircleClose.svg';
// import rejectedIcon from '@ohif/ui/src/elements/Svg/svgs/fullCircleClose.svg';
import { ReactComponent as ReviewedIcon } from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';

// import reviewedIcon from '@ohif/ui/src/elements/Svg/svgs/reload-circle.svg';
import useClickOutside from '../../../../hooks/useClickOutside';
import { useWorkListStore } from '../../../../store/useWorkListStore';
import WorklistCancelledModalReason from '../WorklistCancelledModalReason/WorklistCancelledModalReason';
import WorklistStatusChangeModal from '../WorklistStatusChangeModal/WorklistStatusChangeModal';

import styles from './WorkListStatusDropdown.module.scss';

const statuses = [
  { label: 'Scheduled', type: 'Scheduled', icon: (fill = '#BEBEBF') => <UnreadIcon fill={fill} /> },
  { label: 'In-progress', type: 'In-progress', icon: (fill = '#2E46E9') => <ReviewedIcon fill={fill} /> },
  { label: 'Completed', type: 'Completed', icon: (fill = '#58BC82') => <ApprovedIcon fill={fill} /> },
  { label: 'Cancelled', type: 'Cancelled', icon: (fill = '#FF423B') => <RejectedIcon fill={fill} /> },
];

export default function WorkListStatusDropdown({ currentStatus, worklistId, StudyInstanceUID, selectedStudy }) {
  const { workListSelectedStudies, setWorkListSelectedStudies } = useWorkListStore();
  const [isOpen, setIsOpen] = useState(false);
  const initialStatusOption = statuses.find((stat) => stat.type === currentStatus);
  const [selectedStatus, setSelectedStatus] = useState(initialStatusOption ?? statuses[0]);
  const [showCancellationReasonModal, setShowCancellationReasonModal] = useState(false);
  const [statusChangeTarget, setStatusChangeTarget] = useState(null);

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
  const callback = useCallback(() => setIsOpen(false), []);

  useClickOutside(ref, callback);

  const handleSelectStatus = (status) => {
    if (status.type === 'Cancelled') {
      setShowCancellationReasonModal(true);
    } else {
      // Every transition can carry a reviewer note; completion also captures Performed Procedure.
      setStatusChangeTarget(status.type);
    }
    setIsOpen(false);
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
          onClick={() => setIsOpen((prevState) => !prevState)}
        >
          {selectedStatus.icon('#FFFFFF')}
          <p className={styles.statusLabel}>{selectedStatus.label}</p>
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
                  key={status.type} className={styles.statusItem}
                  onClick={() => handleSelectStatus(status)}>
                  {status.icon()}
                  <p className={classNames(styles.statusItemLabel, styles[status.type])}>{status.label}</p>
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

      {statusChangeTarget && (
        <WorklistStatusChangeModal
          isOpen={!!statusChangeTarget}
          setIsOpen={(open) => setStatusChangeTarget(open ? statusChangeTarget : null)}
          status={statusChangeTarget}
          worklistId={worklistId}
          StudyInstanceUID={StudyInstanceUID}
          handleUpdateStore={handleUpdateStore}
        />
      )}
    </>
  );
}
