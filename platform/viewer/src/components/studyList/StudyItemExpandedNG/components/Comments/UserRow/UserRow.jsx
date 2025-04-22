import React from 'react'

import { getDisplayName } from '../../../../../../lib/getDisplayName';
import { getInitialLetters } from '../../../../../../utils/getUserInitials';

import styles from './UserRow.module.scss';

const UserRow = ({User, LastUpdate}) => {
  const displayName = getDisplayName(User);
  const initials = getInitialLetters(User);

  return (
    <div className={styles.userRow}>
      <div className={styles.avatar}>{initials}</div>
      <span className={styles.title}>{displayName}</span>
      <p className={styles.commentItemDate}>{LastUpdate.split('.')[0]}</p>
    </div>
  );
};

export default UserRow;
