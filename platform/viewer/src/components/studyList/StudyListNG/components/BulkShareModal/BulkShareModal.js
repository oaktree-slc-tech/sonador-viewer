import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useMutation } from '@tanstack/react-query';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { useDebounce } from '@ohif/ui';
import CheckboxNG from '@ohif/ui/src/components/CheckboxNG/CheckboxNG';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';

import { searchAcl } from '../../../../../api/share';
import useClickOutside from '../../../../../hooks/useClickOutside';
import useBulkShare from '../../hooks/useBulkShare';
import { describeStudy } from '../RemoveResourceConfirm/describeRemoval';
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

  // Progress list auto-scroll, so the newest line stays visible on a long run.
  const progressRef = useRef(null);
  useEffect(() => {
    if (progressRef.current) {
      progressRef.current.scrollTop = progressRef.current.scrollHeight;
    }
  }, [progress?.completed]);

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

    const result = await applyBulkShare({ server: activeServer, studies, subjects, permissions });

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
      classes={{ content: styles.modal }}
      onModalClick={(e) => {
        // Keeps stray clicks off the study-list row underneath, matching StudiesTableShareModal.
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {/* Which studies this affects, always visible and never collapsed behind a count: the
          selection is the thing most easily got wrong, and the count alone gives the user nothing
          to check it against. Same reasoning as the bulk removal confirmation. */}
      <div className={styles.section}>
        <p className={styles.sectionLabel}>
          {studies.length} {studies.length === 1 ? 'study' : 'studies'} will be affected
        </p>
        <div className={styles.studyList}>
          {studies.map((study) => {
            const { title, subtitle } = describeStudy(study);

            return (
              <div key={study.StudyInstanceUID} className={styles.studyRow}>
                <span className={styles.studyTitle}>{title}</span>
                {subtitle && <span className={styles.studySubtitle}>{subtitle}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {stage === STAGE.EDIT && (
        <>
          <div className={styles.section}>
            <p className={styles.sectionLabel}>Share with</p>
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

          <div className={styles.section}>
            <p className={styles.sectionLabel}>Permissions</p>
            <p className={styles.sectionNote}>
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

          <div className={styles.bottom}>
            <button type="button" className={styles.cancelBtn} onClick={handleClose}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              disabled={!canApply}
              onClick={() => setStage(STAGE.CONFIRM)}
            >
              Apply
            </button>
          </div>
        </>
      )}

      {stage === STAGE.CONFIRM && (
        <div className={styles.section}>
          <p className={styles.confirmHeading}>{intent.heading}</p>
          <p className={styles.confirmSummary}>{intent.summary}</p>
          <p className={styles.confirmDetail}>{intent.detail}</p>
          <p className={styles.confirmWarning}>{intent.warning}</p>

          <div className={styles.bottom}>
            <button type="button" className={styles.cancelBtn} onClick={() => setStage(STAGE.EDIT)}>
              Back
            </button>
            <button type="button" className={styles.saveBtn} onClick={handleApply}>
              Apply to {intent.total} {intent.total === 1 ? 'policy' : 'policies'}
            </button>
          </div>
        </div>
      )}

      {(stage === STAGE.APPLYING || stage === STAGE.DONE) && progress && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>
            {stage === STAGE.APPLYING
              ? `Applying ${progress.completed} of ${progress.total}...`
              : summariseBulkShare({ applied: outcome?.applied ?? 0, total: outcome?.total ?? 0 })}
          </p>

          <div className={styles.progressTrack}>
            <div
              className={styles.progressBar}
              style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }}
            />
          </div>

          {/* One line per policy, which is where the per-recipient detail lives instead of in a
              toast per write. */}
          <div className={styles.progressLog} ref={progressRef}>
            {progress.entries.map((entry) => (
              <div
                key={entry.key}
                className={classNames(styles.progressEntry, {
                  [styles.progressEntryFailed]: entry.status !== 'ok',
                })}
              >
                <span className={styles.progressEntryLabel}>{entry.label}</span>
                <span className={styles.progressEntryMessage}>{entry.message}</span>
              </div>
            ))}
          </div>

          {stage === STAGE.APPLYING ? (
            <p className={styles.sectionNote}>
              Leave this dialog open until every policy has been written.
            </p>
          ) : (
            <div className={styles.bottom}>
              <button type="button" className={styles.saveBtn} onClick={handleClose}>
                Close
              </button>
            </div>
          )}
        </div>
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
