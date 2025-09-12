import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import Loader from '@ohif/ui/src/components/Loader/Loader';

import { useDeviceStore } from '../../../../../store/useDeviceStore';

import NoCommentsPlaceholder from './NoCommentsPlaceholder/NoCommentsPlaceholder';
import UserRow from './UserRow/UserRow';
import { useCreateSeriesComment, useCreateStudyComment, useSeriesComments, useStudyComments } from './logic';

import styles from './Comments.module.scss';

export default function Comments({  series, studyId }) {
  // Manage and display series comments

  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));
  
  // State management: comments array and new comment text
  const [newCommentText, setNewCommentText] = useState('');
  const { data: seriesCommentsArr = [], isLoading: isLoadingSeriesComments } = useSeriesComments(activeServer, series);
  const { mutate: createSeriesComment, isLoading: isLoadingCreatingSeriesComment } = useCreateSeriesComment(
    activeServer,
    series,
    () => setNewCommentText('')
  );
  const { data: studyCommentsArr = [], isLoading: isLoadingStudyComments } = useStudyComments(activeServer, studyId);
  const { mutate: createStudyComment, isLoading: isLoadingCreatingStudyComment } = useCreateStudyComment(
    activeServer,
    studyId,
    () => setNewCommentText('')
  );
  const { isDesktop } = useDeviceStore();

  useEffect(() => {
    return () => {
      setNewCommentText('');
    };
  }, []);

  const handleChangeNewComment = (event) => {
    setNewCommentText(event.target.value);
  };

  const comments = studyId ? studyCommentsArr : seriesCommentsArr;
  const isLoading = studyId ? isLoadingStudyComments : isLoadingSeriesComments;
  const isMutating = studyId ? isLoadingCreatingStudyComment : isLoadingCreatingSeriesComment;

  return (
    <div className={styles.contentComments}>
      {isLoading ? (
        <div className={styles.loaderWrapper}>
          <Loader />
        </div>
      ) : Array.isArray(comments) && comments.length > 0 ? (
        comments.map(({ LastUpdate, Text, User }, index) => (
          <div key={index} className={styles.commentItem}>
            <div className={styles.commentItemHeader}>
              <UserRow User={User} LastUpdate={LastUpdate} />
            </div>
            <p className={styles.commentItemText}>
              <ReactMarkdown>{Text}</ReactMarkdown>
            </p>
          </div>
        ))
      ) : (
        <NoCommentsPlaceholder studyId={studyId} />
      )}


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
          onClick={() => {
            studyId ? createStudyComment(newCommentText) : createSeriesComment(newCommentText);
          }}
          className={styles.commentsNewCommentSubmit}
          disabled={isMutating}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

Comments.propTypes = {
  series: PropTypes.object,
  studyId: PropTypes.string,
};
