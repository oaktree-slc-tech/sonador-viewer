import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useMutation } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import { useDebounce } from '@ohif/ui';
import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { searchAcl } from '../../../../../api/share';
import useClickOutside from '../../../../../hooks/useClickOutside';
import useBulkShare from '../../hooks/useBulkShare';
import BulkProgressPanel from '../bulkAction/BulkProgressPanel';
import BulkStudyList from '../bulkAction/BulkStudyList';
import { ReactComponent as GroupIcon } from '../StudiesTableShareModal/group.svg';
import { ReactComponent as TrashIcon } from '../StudiesTableShareModal/trash.svg';
import { ReactComponent as UserIcon } from '../StudiesTableShareModal/user.svg';

import {
  describeBulkShareIntent,
  describeSubject,
  isUserSubject,
  subjectKeyOf,
  summariseBulkShare,
} from './bulkSharePlan';
import { emptyPermissions,PERMISSION_IDS } from './permissionFields';

import bulk from '../bulkAction/bulkAction.module.scss';
import styles from './BulkShareModal.module.scss';


// Stages of the dialog. `confirm` is a deliberate second step rather than a window.confirm: the
// operation is large, silent from the study list's point of view (there is no ACL column to watch
// change), and it overwrites existing permissions.
const STAGE = {
  EDIT: 'edit',
  CONFIRM: 'confirm',
  APPLYING: 'applying',
  DONE: 'done',
};


// How long a clean run's completed state is held before the dialog closes itself. Long enough to
// read the final count and see the closing notification arrive, short enough not to feel stuck.
const COMPLETION_HOLD_MS = 2000;


export default function BulkShareModal({ isOpen, setIsOpen, studies = [] }) {
  // Apply one set of ACL permissions to a whole selection of studies at once.
  //
  // Separate from StudiesTableShareModal rather than a mode inside it: that dialog edits and
  // revokes the policies of ONE study and is driven by what the server currently reports, while
  // this one composes a single policy and writes it across many. Sharing a component would mean a
  // form whose every field means something different depending on the selection size.

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  const [stage, setStage] = useState(STAGE.EDIT);
  const [subjects, setSubjects] = useState([]);
  const [permissions, setPermissions] = useState(emptyPermissions);
  const [outcome, setOutcome] = useState(null);

  const { isApplying, progress, applyBulkShare, finishBulkShare, resetProgress } = useBulkShare();

  // Search
  const [searchValue, setSearchValue] = useState('');
  const [showList, setShowList] = useState(false);
  const autocompleteRef = useRef(null);
  const debouncedSearch = useDebounce(searchValue, 300);

  useClickOutside(autocompleteRef, useCallback(() => setShowList(false), []));

  const {
    mutate: searchUserGroup,
    data: foundUsersGroupsList,
    reset: resetFoundUsersGroupsList,
  } = useMutation({
    mutationFn: (params) => searchAcl(activeServer, params),
  });

  useEffect(() => {
    if (debouncedSearch) {
      searchUserGroup({ term: debouncedSearch });
    }
  }, [debouncedSearch]);

  const intent = useMemo(
    () => describeBulkShareIntent({ studies, subjects, permissions }),
    [studies, subjects, permissions]
  );

  const selectedKeys = useMemo(() => new Set(subjects.map(subjectKeyOf)), [subjects]);

  const handleChangeSearch = ({ target }) => {
    resetFoundUsersGroupsList();
    setSearchValue(target.value);
    setShowList(target.value.length > 0);
  };

  const handleSelectSubject = (result) => {
    // Additive, and de-duplicated: the search box is the way to build up a list of recipients, so
    // picking the same group twice must not double its policies.
    setSubjects((prev) =>
      prev.some((s) => subjectKeyOf(s) === subjectKeyOf(result)) ? prev : [...prev, result]
    );
    setSearchValue('');
    setShowList(false);
  };

  const handleRemoveSubject = (key) =>
    setSubjects((prev) => prev.filter((s) => subjectKeyOf(s) !== key));

  const handleTogglePermission = (id) => (event) =>
    setPermissions((prev) => ({ ...prev, [id]: event.target.checked }));

  const closeTimer = useRef(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Set synchronously, before the first await. `stage` and `isApplying` are state and land a render
  // too late to stop a second invocation of this handler from starting a second run -- and a second
  // run means a second POST for every pair, which the gateway rejects as a duplicate.
  const appliedRef = useRef(false);

  const handleApply = async () => {
    if (appliedRef.current) {
      return;
    }

    appliedRef.current = true;
    setStage(STAGE.APPLYING);

    let result;

    try {
      result = await applyBulkShare({ server: activeServer, studies, subjects, permissions });
    } catch (err) {
      // The run is not supposed to reject -- every write failure is reported per policy and the loop
      // carries on. But if it ever does, the dialog must not be left in APPLYING: `handleClose`
      // refuses to close while a run is in flight, so an unrecovered rejection here leaves the user
      // looking at a dialog they cannot dismiss. Fall back to the form, which is closable, and let
      // the error surface rather than swallowing it.
      console.error('Bulk share: the run rejected unexpectedly.', err);
      result = null;
    }

    if (!result) {
      // Nothing to issue, or a run was already in flight. Falls back to the form rather than
      // showing a progress panel with no progress in it, and releases the latch so the user can
      // correct the selection and try again.
      appliedRef.current = false;
      setStage(STAGE.EDIT);
      return;
    }

    setOutcome(result);
    setStage(STAGE.DONE);

    await finishBulkShare({ outcome: result, studies });

    // Closes itself when everything landed. On a partial failure it stays up instead: the progress
    // log is the only place the user can see WHICH policies were not written, and closing over it
    // would leave them with a count and nothing to act on.
    if (result && result.failed === 0) {
      closeTimer.current = setTimeout(() => {
        resetProgress();
        setIsOpen(false);
      }, COMPLETION_HOLD_MS);
    }
  };

  const handleClose = () => {
    // Blocking while the run is in flight (the close control is inert, and the backdrop already
    // swallows its own clicks) so a half-applied selection cannot be walked away from mid-write.
    if (stage === STAGE.APPLYING || isApplying) {
      return;
    }

    resetProgress();
    setIsOpen(false);
  };

  const canApply = subjects.length > 0 && studies.length > 0;

  return (
    <ModalNG
      isOpen={isOpen}
      title="Share Access"
      onClose={handleClose}
      classes={{ content: bulk.modal }}
      onModalClick={(e) => {
        // Keeps stray clicks off the study-list row underneath, matching StudiesTableShareModal.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <BulkStudyList
        studies={studies}
        heading={(count) => `${count} ${count === 1 ? 'study' : 'studies'} will be affected`}
      />

      {stage === STAGE.EDIT && (
        <>
          <div className={bulk.section}>
            <p className={bulk.sectionLabel}>Share with</p>
            <div className={styles.autoComplete} ref={autocompleteRef}>
              <input
                type="search"
                placeholder="Add users or groups"
                value={searchValue}
                onChange={handleChangeSearch}
                className={styles.autoCompleteInput}
              />
              {showList && foundUsersGroupsList?.length > 0 && (
                <div className={styles.autoCompleteList}>
                  {foundUsersGroupsList.map((result) => (
                    <button
                      key={result['result-type'] + result.id}
                      className={styles.autoCompleteListItem}
                      disabled={selectedKeys.has(subjectKeyOf(result))}
                      onClick={() => handleSelectSubject(result)}
                    >
                      {isUserSubject(result) ? (
                        <UserIcon className={styles.userIcon} />
                      ) : (
                        <GroupIcon className={styles.groupIcon} />
                      )}
                      <span>{describeSubject(result)}</span>
                      {result.email && <span className={styles.userEmail}>{result.email}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {subjects.length > 0 && (
              <div className={styles.subjectList}>
                {subjects.map((subject) => {
                  const key = subjectKeyOf(subject);

                  return (
                    <span key={key} className={styles.subjectChip}>
                      {isUserSubject(subject) ? (
                        <UserIcon className={styles.userIcon} />
                      ) : (
                        <GroupIcon className={styles.groupIcon} />
                      )}
                      <span className={styles.subjectName}>{describeSubject(subject)}</span>
                      <TrashIcon
                        className={styles.subjectRemove}
                        onClick={() => handleRemoveSubject(key)}
                      />
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className={bulk.section}>
            <p className={bulk.sectionLabel}>Permissions</p>
            <p className={bulk.sectionNote}>
              Applied identically to every recipient on every study listed above.
            </p>
            {/* CheckboxNG renders its own <label> and stops click propagation, so the text goes
                through its `label` prop rather than a wrapper element -- nesting labels would
                leave the caption a dead click target. */}
            <div className={styles.permissionRow}>
              {PERMISSION_IDS.map(({ id, label }) => (
                <CheckboxNG
                  key={id}
                  label={label}
                  onChange={handleTogglePermission(id)}
                  checked={permissions[id]}
                  classes={{ label: styles.permission, checkmark: styles.checkmark }}
                />
              ))}
            </div>
          </div>

          <div className={bulk.bottom}>
            <button type="button" className={bulk.cancelBtn} onClick={handleClose}>
              Cancel
            </button>
            <button
              type="button"
              className={bulk.saveBtn}
              disabled={!canApply}
              onClick={() => setStage(STAGE.CONFIRM)}
            >
              Apply
            </button>
          </div>
        </>
      )}

      {stage === STAGE.CONFIRM && (
        <div className={bulk.section}>
          <p className={styles.confirmHeading}>{intent.heading}</p>
          <p className={bulk.intentSummary}>{intent.summary}</p>
          <p className={bulk.intentDetail}>{intent.detail}</p>
          <p className={bulk.calloutWarning}>{intent.warning}</p>

          <div className={bulk.bottom}>
            <button type="button" className={bulk.cancelBtn} onClick={() => setStage(STAGE.EDIT)}>
              Back
            </button>
            <button type="button" className={bulk.saveBtn} onClick={handleApply}>
              Apply to {intent.total} {intent.total === 1 ? 'policy' : 'policies'}
            </button>
          </div>
        </div>
      )}

      {(stage === STAGE.APPLYING || stage === STAGE.DONE) && (
        <BulkProgressPanel
          progress={progress}
          isRunning={stage === STAGE.APPLYING}
          runningLabel={`Applying ${progress?.completed ?? 0} of ${progress?.total ?? 0}...`}
          doneLabel={summariseBulkShare({
            applied: outcome?.applied ?? 0,
            total: outcome?.total ?? 0,
          })}
          runningNote="Leave this dialog open until every policy has been written."
          onClose={handleClose}
        />
      )}
    </ModalNG>
  );
}


BulkShareModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  setIsOpen: PropTypes.func.isRequired,
  /** Study descriptors from `_getStudyDescriptor` -- StudyInstanceUID plus display attributes. */
  studies: PropTypes.arrayOf(PropTypes.object),
};
