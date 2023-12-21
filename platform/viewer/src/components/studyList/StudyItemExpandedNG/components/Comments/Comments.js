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
  const {
    data: commentsArr = [],
    isLoading: isLoadingComments,
    error: commentsError,
  } = useSeriesComments(server, series);
  const { mutate: createComment } = useCreateComment(server, series, () => setNewCommentText(''));
  const { isDesktop } = useDeviceStore();

  const handleChangeNewComment = (event) => {
    setNewCommentText(event.target.value);
  };

  return (
    <div className={styles.contentComments}>
      {commentsError && <p>{JSON.stringify(commentsError)}</p>}
      {isLoadingComments ? (
        <div className={styles.loaderWrapper}>
          <Loader />
        </div>
      ) : (
        commentsArr.map(({ LastUpdate, Text }, index) => {
          return (
            <div key={index} className={styles.commentItem}>
              <div className={styles.commentItemHeader}>
                <div className={styles.commentItemAvatar} />
                {/* TODO there is no author in response */}
                {/*<p className={styles.commentItemAuthor}>{author}</p>*/}
                <p className={styles.commentItemDate}>{LastUpdate.split('.')[0]}</p>
              </div>
              <p className={styles.commentItemText}>{Text}</p>
            </div>
          );
        })
      )}
      <div className={styles.commentsNewCommentForm}>
        {isDesktop && <div className={styles.commentsNewCommentAvatar} />}
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
