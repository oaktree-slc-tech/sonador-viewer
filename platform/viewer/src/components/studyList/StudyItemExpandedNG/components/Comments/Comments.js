import React, { useState } from 'react';

import { useDeviceStore } from '../../../../../store/useDeviceStore';

import { commentsArr } from './mocks';

import styles from './Comments.module.scss';

export default function Comments() {
  const [newCommentText, setNewCommentText] = useState('');

  const { isDesktop } = useDeviceStore();

  const handleChangeNewComment = (event) => {
    setNewCommentText(event.target.value);
  };

  return (
    <div className={styles.contentComments}>
      {commentsArr.map(({ author, date, comment }, index) => {
        return (
          <div key={index} className={styles.commentItem}>
            <div className={styles.commentItemHeader}>
              <div className={styles.commentItemAvatar} />
              <p className={styles.commentItemAuthor}>{author}</p>
              <p className={styles.commentItemDate}>{date}</p>
            </div>
            <p className={styles.commentItemText}>{comment}</p>
          </div>
        );
      })}
      <form className={styles.commentsNewCommentForm}>
        {isDesktop && <div className={styles.commentsNewCommentAvatar} />}
        <textarea
          value={newCommentText}
          onChange={handleChangeNewComment}
          placeholder="Write a comment..."
          className={styles.commentsNewCommentTextarea}
        />
        <button type="submit" className={styles.commentsNewCommentSubmit}>
          Submit
        </button>
      </form>
    </div>
  );
}
