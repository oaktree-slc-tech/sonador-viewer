import React from 'react'

import { getInitialLetters } from '../../../../../../utils/getUserInitials';

import styles from './UserRow.module.scss';


const getDisplayName = (user)  => {
  if (user.first_name || user.last_name) {
    return `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  }
  return user.email ?? user.username;
};


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
