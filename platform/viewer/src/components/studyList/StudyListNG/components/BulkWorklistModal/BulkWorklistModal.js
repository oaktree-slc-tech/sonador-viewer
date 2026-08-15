import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux } from '@ohif/core';
import BouncingLoader from '@ohif/ui/src/components/Loader/BouncingLoader';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import useBulkWorklist from '../../hooks/useBulkWorklist';
import BulkProgressPanel from '../bulkAction/BulkProgressPanel';
import BulkStudyList from '../bulkAction/BulkStudyList';
import useWorklistRequestForm from '../worklistRequest/useWorklistRequestForm';
import WorklistRequestFields from '../worklistRequest/WorklistRequestFields';

import {
  buildWorklistOperations,
  describeBulkWorklistIntent,
  summariseBulkWorklist,
} from './bulkWorklistPlan';

import bulk from '../bulkAction/bulkAction.module.scss';


// Stages of the dialog.
//
// There is deliberately NO confirmation stage, unlike BulkShareModal. That dialog has one because a
// bulk share OVERWRITES permissions the recipient already had -- silently, and irreversibly from the
// user's point of view. Requesting reviews is additive: nothing is replaced, every request is visible
// in the worklist immediately afterwards, and a mistaken one can be cancelled there. Adding a second
// click to this flow would work against the reason it exists, which is that assigning fifteen studies
// one at a time is too many clicks. The intent sentence is shown inline above the button instead, so
// the magnitude is still stated before the run starts.
const STAGE = {
  EDIT: 'edit',
  APPLYING: 'applying',
  DONE: 'done',
};


// How long a clean run's completed state is held before the dialog closes itself. Matches
// BulkShareModal: long enough to read the final count and see the closing notification arrive, short
// enough not to feel stuck.
const COMPLETION_HOLD_MS = 2000;


export default function BulkWorklistModal({ isOpen, setIsOpen, studies = [] }) {
  // Request a review of a whole selection of studies at once, from one group, one reviewer, and one
  // reason.
  //
  // Separate from CreateWorklistModal rather than a mode inside it: that dialog creates a request for
  // the study whose row menu was opened and has no notion of a run that can partly fail, while this
  // one issues N writes and has to report which of them landed. What the two DO share -- the form
  // itself -- is shared as a component rather than copied.

  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const [stage, setStage] = useState(STAGE.EDIT);
  const [outcome, setOutcome] = useState(null);

  const { isRequesting, progress, requestBulkReview, finishBulkReview, resetProgress } =
    useBulkWorklist();

  const { form, fields, canSubmit, procedure } = useWorklistRequestForm(activeServer);

  const operations = useMemo(() => buildWorklistOperations({ studies }), [studies]);

  const intent = useMemo(
    () => describeBulkWorklistIntent({ studies, form }),
    [studies, form]
  );

  const closeTimer = useRef(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Set synchronously, before the first await. `stage` and `isRequesting` are state and land a render
  // too late to stop a second invocation of this handler from starting a second run -- and a second
  // run means a second review request for every study, which the worklist endpoint accepts rather
  // than rejects, so the reviewer would simply see everything twice.
  const requestedRef = useRef(false);

  const handleCreate = async () => {
    if (requestedRef.current) {
      return;
    }

    requestedRef.current = true;
    setStage(STAGE.APPLYING);

    let result;

    try {
      result = await requestBulkReview({
        server: activeServer,
        operations,
        group: form.group,
        member: form.member,
        procedure,
      });
    } catch (err) {
      // The run is not supposed to reject -- every write failure is reported per study and the loop
      // carries on. But if it ever does, the dialog must not be left in APPLYING: `handleClose`
      // refuses to close while a run is in flight, so an unrecovered rejection here leaves the user
      // looking at a dialog they cannot dismiss. Fall back to the form, which is closable, and let
      // the error surface rather than swallowing it.
      console.error('Bulk review request: the run rejected unexpectedly.', err);
      result = null;
    }

    if (!result) {
      // Nothing to issue, or a run was already in flight. Falls back to the form rather than showing
      // a progress panel with no progress in it, and releases the latch so the user can correct the
      // selection and try again.
      requestedRef.current = false;
      setStage(STAGE.EDIT);
      return;
    }

    setOutcome(result);
    setStage(STAGE.DONE);

    await finishBulkReview({ outcome: result, studies });

    // Closes itself when everything landed. On a partial failure it stays up instead: the progress
    // log is the only place the user can see WHICH studies were not requested, and closing over it
    // would leave them with a count and nothing to act on.
    if (result.failed === 0) {
      closeTimer.current = setTimeout(() => {
        resetProgress();
        setIsOpen(false);
      }, COMPLETION_HOLD_MS);
    }
  };

  const handleClose = (e) => {
    // Blocking while the run is in flight (the close control is inert, and the backdrop already
    // swallows its own clicks) so a half-created batch cannot be walked away from mid-write.
    e?.stopPropagation?.();

    if (stage === STAGE.APPLYING || isRequesting) {
      return;
    }

    resetProgress();
    setIsOpen(false);
  };

  const canCreate = canSubmit && operations.length > 0;

  return (
    <ModalNG
      isOpen={isOpen}
      title="Request Review"
      onClose={handleClose}
      classes={{ content: bulk.modal }}
      onModalClick={(e) => {
        // Keeps stray clicks off the study-list row underneath, matching the other bulk dialogs.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <BulkStudyList
        studies={studies}
        heading={(count) => `${count} ${count === 1 ? 'study' : 'studies'} will be sent for review`}
      />

      {stage === STAGE.EDIT && (
        <>
          <WorklistRequestFields fields={fields} idPrefix="bulk-worklist" />

          <div className={bulk.section}>
            <p className={bulk.intentSummary}>{intent.summary}</p>
            <p className={bulk.intentDetail}>{intent.detail}</p>
            {intent.note && <p className={bulk.calloutWarning}>{intent.note}</p>}
          </div>

          <div className={bulk.bottom}>
            <button type="button" className={bulk.cancelBtn} onClick={handleClose}>
              Cancel
            </button>
            <button
              type="button"
              className={bulk.saveBtn}
              disabled={!canCreate}
              onClick={handleCreate}
            >
              Create Worklist
            </button>
          </div>
        </>
      )}

      {(stage === STAGE.APPLYING || stage === STAGE.DONE) && (
        <BulkProgressPanel
          progress={progress}
          isRunning={stage === STAGE.APPLYING}
          runningLabel={
            <span className={bulk.runningLabel}>
              <BouncingLoader width={40} height={20} />
              {`Requesting ${progress?.completed ?? 0} of ${progress?.total ?? 0}...`}
            </span>
          }
          doneLabel={summariseBulkWorklist({
            created: outcome?.created ?? 0,
            total: outcome?.total ?? 0,
          })}
          runningNote="Leave this dialog open until every request has been created."
          onClose={handleClose}
        />
      )}
    </ModalNG>
  );
}


BulkWorklistModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  setIsOpen: PropTypes.func.isRequired,
  /** Study descriptors from `_getStudyDescriptor` -- StudyInstanceUID plus display attributes. */
  studies: PropTypes.arrayOf(PropTypes.object),
};
