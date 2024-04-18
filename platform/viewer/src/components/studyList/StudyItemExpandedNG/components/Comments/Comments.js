import React, { useState } from 'react';
import PropTypes from 'prop-types';

import Loader from '@ohif/ui/src/components/Loader/Loader';

import { useDeviceStore } from '../../../../../store/useDeviceStore';

import { useCreateComment, useSeriesComments } from './logic';

import styles from './Comments.module.scss';

export default function Comments({ server, series }) {
  // Manage and display series comments

  // State management: comments array and new comment text
  const [newCommentText, setNewCommentText] = useState('');
  const { data: commentsArr = [], isLoading: isLoadingComments } = useSeriesComments(server, series);
  const { mutate: createComment } = useCreateComment(server, series, () => setNewCommentText(''));
  const { isDesktop } = useDeviceStore();

  const handleChangeNewComment = (event) => {
    setNewCommentText(event.target.value);
  };

  return (
    <div className={styles.contentComments}>
      {isLoadingComments ? (
        <div className={styles.loaderWrapper}>
          <Loader />
        </div>
      ) : Array.isArray(commentsArr) ? (
        commentsArr.map(({ LastUpdate, Text }, index) => {
          return (
            <div key={index} className={styles.commentItem}>
              <div className={styles.commentItemHeader}>
                {/* TODO there is no author in response */}
                {/*<div className={styles.commentItemAvatar} />*/}
                {/*<p className={styles.commentItemAuthor}>{author}</p>*/}
                <p className={styles.commentItemDate}>{LastUpdate.split('.')[0]}</p>
              </div>
              <p className={styles.commentItemText}>{Text}</p>
            </div>
          );
        })
      ) : null}
      <div className={styles.commentsNewCommentForm}>
        {/* TODO: Add back avatar styling when author added to response. className={styles.commentsNewCommentAvatar} */}
        {isDesktop && <div />}
        <textarea
          value={newCommentText}
          onChange={handleChangeNewComment}
          placeholder="Write a comment..."
          className={styles.commentsNewCommentTextarea}
        />
        <button
          onClick={() => createComment(newCommentText)}
          className={styles.commentsNewCommentSubmit}
          disabled={isLoadingComments}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

Comments.propTypes = {
  server: PropTypes.object.isRequired,
  series: PropTypes.object,
};
