// The four controls a review request is composed from: group, reviewer, reason, requested procedure.
//
// One copy, rendered by both the per-study dialog and the bulk one. Previously each dialog had its
// own markup for these, which is how they drifted: the per-study one filtered its membership list
// case-sensitively, and gave BOTH its group input and its member input `id="group-search"` -- so its
// two <label> elements pointed at the same control and clicking the reviewer caption focused the
// group field.
//
// Ids are namespaced by `idPrefix` so the labels stay correctly bound no matter which dialog renders
// them, or how many.

import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { describeGroup, describeMember } from './worklistRequestForm';

import groupSearchStyles from '../../../../../styles/groupSearch.module.scss';
import styles from './WorklistRequestFields.module.scss';


function Suggestions({ id, items, describe, onSelect, keyOf }) {
  // The click target is a <button> inside the <li> rather than the <li> itself, so a suggestion can
  // be reached and chosen from the keyboard. The shared dropdown-item class still carries the look,
  // so these read the same as every other group/member search in the viewer.
  if (!items.length) {
    return null;
  }

  return (
    <ul id={id} className={classNames(groupSearchStyles.dropdown, styles.dropdown)}>
      {items.map((item) => (
        <li key={keyOf(item)}>
          <button
            type="button"
            className={classNames(groupSearchStyles.dropdownItem, styles.dropdownButton)}
            onClick={() => onSelect(item)}
          >
            {describe(item)}
          </button>
        </li>
      ))}
    </ul>
  );
}

Suggestions.propTypes = {
  id: PropTypes.string,
  items: PropTypes.array.isRequired,
  describe: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  keyOf: PropTypes.func.isRequired,
};


export default function WorklistRequestFields({ fields, idPrefix, reasonRows = 3 }) {
  const {
    form,
    groupRef, groups, showGroups, onGroupFocus, onGroupTermChange, onGroupSelect,
    memberRef, members, showMembers, onMemberFocus, onMemberTermChange, onMemberSelect,
    onReasonChange, onProcedureChange,
  } = fields;

  const id = (name) => `${idPrefix}-${name}`;

  return (
    <>
      <div className={styles.field} ref={groupRef}>
        <label className={styles.label} htmlFor={id('group')}>Select Group</label>
        <div className={styles.autoComplete}>
          <input
            id={id('group')}
            type="text"
            // The suggestion list is the only valid source of a group, so the browser's own history
            // dropdown would only ever offer text that cannot be submitted.
            autoComplete="off"
            role="combobox"
            aria-expanded={showGroups && groups.length > 0}
            aria-controls={id('group-suggestions')}
            value={form.groupTerm}
            onChange={(e) => onGroupTermChange(e.target.value)}
            onFocus={onGroupFocus}
            placeholder="Search for a group"
            className={styles.input}
          />
          {showGroups && (
            <Suggestions
              id={id('group-suggestions')}
              items={groups}
              describe={describeGroup}
              onSelect={onGroupSelect}
              keyOf={(group) => group.id}
            />
          )}
        </div>
      </div>

      {/* Reviewer, reason and procedure are disclosed progressively, each once the field above it is
          answered. Because typing in the group field clears the group (see worklistRequestForm),
          editing a chosen group visibly retracts the reviewer -- which is the point: the reviewer
          under the old group is no longer valid. */}
      {form.group && (
        <div className={styles.field} ref={memberRef}>
          <label className={styles.label} htmlFor={id('member')}>Select Reviewer</label>
          <div className={styles.autoComplete}>
            <input
              id={id('member')}
              type="text"
              autoComplete="off"
              role="combobox"
              aria-expanded={showMembers && members.length > 0}
              aria-controls={id('member-suggestions')}
              value={form.memberTerm}
              onChange={(e) => onMemberTermChange(e.target.value)}
              onFocus={onMemberFocus}
              placeholder="Search for a member"
              className={styles.input}
            />
            {showMembers && (
              <Suggestions
                id={id('member-suggestions')}
                items={members}
                describe={describeMember}
                onSelect={onMemberSelect}
                keyOf={(member) => member.id}
              />
            )}
          </div>
        </div>
      )}

      {form.member && (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={id('reason')}>Reason for Review (optional)</label>
            <textarea
              id={id('reason')}
              value={form.reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Why is this being reviewed?"
              className={styles.input}
              rows={reasonRows}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={id('procedure')}>
              Requested Procedure (optional)
            </label>
            <input
              id={id('procedure')}
              type="text"
              value={form.procedure}
              onChange={(e) => onProcedureChange(e.target.value)}
              placeholder="Describe the requested procedure"
              className={styles.input}
            />
          </div>
        </>
      )}
    </>
  );
}


WorklistRequestFields.propTypes = {
  /** The `fields` bundle from useWorklistRequestForm. */
  fields: PropTypes.object.isRequired,
  /** Namespaces the control ids so the labels bind correctly per dialog. */
  idPrefix: PropTypes.string.isRequired,
  reasonRows: PropTypes.number,
};
