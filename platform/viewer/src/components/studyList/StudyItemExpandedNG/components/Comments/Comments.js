import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { useSelector } from 'react-redux';
import { useQueryClient } from '@tanstack/react-query';
import PropTypes from 'prop-types';

import { uiNotificationService } from '@ohif/core';
import Loader from '@ohif/ui/src/components/Loader/Loader';

import useResourceAclPermissions from '../../../../../hooks/useResourceAclPermissions';
import useServerSystemInfo from '../../../../../hooks/useServerSystemInfo';
import { describeComment } from '../../../StudyListNG/components/RemoveResourceConfirm/describeRemoval';
import RemoveResourceConfirm from '../../../StudyListNG/components/RemoveResourceConfirm/RemoveResourceConfirm';

import CommentActionsMenu from './CommentActionsMenu/CommentActionsMenu';
import NoCommentsPlaceholder from './NoCommentsPlaceholder/NoCommentsPlaceholder';
import UserRow from './UserRow/UserRow';
import { commentActions } from './commentPermissions';
import {
  ALL_SERIES_COMMENTS_QUERY_KEY,
  SERIES_COMMENTS_QUERY_KEY,
  STUDY_COMMENTS_QUERY_KEY,
  useCreateSeriesComment,
  useCreateStudyComment,
  useRemoveSeriesComment,
  useRemoveStudyComment,
  useSeriesComments,
  useStudyComments,
  useUpdateSeriesComment,
  useUpdateStudyComment,
} from './logic';

import styles from './Comments.module.scss';


export default function Comments({
  series,
  studyId,
  studyInstanceUID,
}) {
  // Manage and display study or series comments. `studyId` set means the study's own comments;
  // otherwise the comments of `series`. `studyInstanceUID` is the study either way, so the
  // permissions below resolve against the exact resource the comments belong to.

  const { t } = useTranslation('StudyList');
  const activeServer = useSelector((state) => state.servers.servers.find((s) => s.active));

  // Effective grants on the resource that owns these comments: the study-or-server grant, plus the
  // series' own grant when a series is shown. Resolved for the exact series, so a grant on one
  // series never enables actions on the study or on a sibling.
  const {
    aclCommentEdit: commentsEdit,
    aclRemove: commentsRemove,
    resolveSeriesAcl,
    refresh: refreshPermissions,
  } = useResourceAclPermissions({
    server: activeServer,
    StudyInstanceUID: studyInstanceUID || studyId,
    SeriesInstanceUID: studyId ? undefined : series?.SeriesInstanceUID,
  });

  useEffect(() => {
    // The series grant decides whether a menu appears at all, so it is resolved when the panel
    // shows the series rather than when a menu opens.
    resolveSeriesAcl();
  }, [resolveSeriesAcl]);

  // The resource whose comments are on screen; an edit or removal in flight belongs to the one it
  // started on.
  const resourceKey = studyId ? `study:${studyId}` : `series:${series?.SeriesInstanceUID || ''}`;

  // Who the signed-in user is, from the imaging server's system report, which the plugin fills
  // in for the request user. Comments carry their author's id, so the two decide ownership.
  const { sysInfo } = useServerSystemInfo(activeServer);
  const currentUserId = sysInfo?.User?.id;
  
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

  // Inline edit: the comment being edited and its working text.
  const [editing, setEditing] = useState(null);
  const editTextareaRef = useRef(null);
  const { mutateAsync: updateSeriesComment, isLoading: isUpdatingSeriesComment } = useUpdateSeriesComment(
    activeServer,
    series
  );
  const { mutateAsync: updateStudyComment, isLoading: isUpdatingStudyComment } = useUpdateStudyComment(
    activeServer,
    studyId
  );

  // Pending removal. The comment is captured when the action is chosen so the confirmation
  // keeps naming the comment the user picked even if the list refreshes underneath it.
  const [pendingRemoval, setPendingRemoval] = useState(null);
  // Where keyboard focus lands after a removal: the menu that opened the confirmation leaves the
  // document with its comment, and the compose box is the panel's surviving control.
  const composeRef = useRef(null);
  const { mutateAsync: removeSeriesComment, isLoading: isRemovingSeriesComment } = useRemoveSeriesComment(
    activeServer,
    series
  );
  const { mutateAsync: removeStudyComment, isLoading: isRemovingStudyComment } = useRemoveStudyComment(
    activeServer,
    studyId
  );

  useEffect(() => {
    return () => {
      setNewCommentText('');
    };
  }, []);

  useEffect(() => {
    // An edit in progress does not follow the user to another resource.
    setEditing(null);
  }, [studyId, series?.SeriesInstanceUID]);

  useEffect(() => {
    // Editing starts in the text box, where the user's next keystroke is expected.
    if (editing?.ID) {
      editTextareaRef.current?.focus();
    }
  }, [editing?.ID]);

  const handleChangeNewComment = (event) => {
    setNewCommentText(event.target.value);
  };

  const notificationScope = {
    studyInstanceUID: studyId || series?.StudyInstanceUID,
    seriesInstanceUID: studyId ? undefined : series?.SeriesInstanceUID,
  };

  const queryClient = useQueryClient();
  const refreshComments = () => (studyId
    ? queryClient.invalidateQueries({ queryKey: [STUDY_COMMENTS_QUERY_KEY, studyId] })
    : Promise.all([
      queryClient.invalidateQueries({ queryKey: [ALL_SERIES_COMMENTS_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: [SERIES_COMMENTS_QUERY_KEY, series?.SeriesInstanceUID] }),
    ]));

  const handleSaveEdit = async () => {
    const target = editing;
    const text = (target.Text || '').trim();

    if (!text) {
      return;
    }

    // Only the editor this save started from is closed when it completes. A newer editor the
    // user opened meanwhile, on another comment or after a resource switch, is left alone.
    const closeThisEditor = () => setEditing((open) => (
      open && open.ID === target.ID && open.resourceKey === target.resourceKey ? null : open
    ));

    try {
      await (studyId
        ? updateStudyComment({ commentId: target.ID, text })
        : updateSeriesComment({ commentId: target.ID, text }));

      closeThisEditor();
    } catch (err) {
      if (err?.status === 404) {
        // Removed by someone else while it was being edited: say so, drop the draft, and let the
        // list refresh to what the server has.
        closeThisEditor();
        uiNotificationService.show({
          title: 'Comment no longer exists',
          message: 'The comment was removed while it was being edited, so the change was not saved.',
          type: 'warning',
          ...notificationScope,
          details: { url: err?.url, status: err?.status },
        });
        refreshComments();
        return;
      }

      if (err?.status === 400 || err?.status === 403) {
        // Refused by the server's rule: the grants the menu was built on may have changed.
        refreshPermissions();
      }

      // The draft stays in the editor so the text is not lost.
      uiNotificationService.show({
        title: 'Comment not updated',
        message: 'The comment could not be updated on the imaging server.',
        type: 'error',
        autoClose: false,
        ...notificationScope,
        details: { url: err?.url, status: err?.status, body: err?.body },
        error: err,
      });
    }
  };

  const handleConfirmRemove = async () => {
    const comment = pendingRemoval;
    const { title: author } = describeComment(comment);

    try {
      await (studyId ? removeStudyComment(comment.ID) : removeSeriesComment(comment.ID));

      uiNotificationService.show({
        title: 'Comment removed',
        message: `The comment by ${author} was permanently removed from the imaging server.`,
        type: 'success',
        ...notificationScope,
        log: true,
      });
    } catch (err) {
      if (err?.status === 400 || err?.status === 403) {
        refreshPermissions();
      }

      // Sticky: a transient toast for a removal that did NOT happen is worse than no toast.
      // `error` and the request details put it in the Issues list.
      uiNotificationService.show({
        title: 'Comment not removed',
        message: `The comment by ${author} could not be removed from the imaging server.`,
        type: 'error',
        autoClose: false,
        ...notificationScope,
        details: { url: err?.url, status: err?.status, body: err?.body },
        error: err,
      });
    } finally {
      setPendingRemoval(null);
    }
  };

  const comments = studyId ? studyCommentsArr : seriesCommentsArr;
  const isLoading = studyId ? isLoadingStudyComments : isLoadingSeriesComments;
  const isMutating = studyId ? isLoadingCreatingStudyComment : isLoadingCreatingSeriesComment;
  const isUpdating = studyId ? isUpdatingStudyComment : isUpdatingSeriesComment;
  const isRemoving = studyId ? isRemovingStudyComment : isRemovingSeriesComment;

  const renderEditForm = (comment) => (
    <div className={styles.commentEditForm}>
      <textarea
        ref={editTextareaRef}
        value={editing.Text}
        onChange={(event) => setEditing({ ...editing, Text: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setEditing(null);
          }
        }}
        className={styles.commentEditTextarea}
        aria-label={t('Edit Comment')}
        disabled={isUpdating}
      />
      <div className={styles.commentEditActions}>
        <button
          type="button"
          className={styles.commentEditSave}
          disabled={isUpdating || !(editing.Text || '').trim() || editing.Text === comment.Text}
          onClick={handleSaveEdit}
        >
          {isUpdating ? t('Saving...') : t('Save')}
        </button>
        <button
          type="button"
          className={styles.commentEditCancel}
          disabled={isUpdating}
          onClick={() => setEditing(null)}
        >
          {t('Cancel')}
        </button>
      </div>
    </div>
  );

  return (
    <div className={styles.contentComments}>
      {isLoading ? (
        <div className={styles.loaderWrapper}>
          <Loader />
        </div>
      ) : Array.isArray(comments) && comments.length > 0 ? (
        comments.map((comment, index) => {
          const { ID, LastUpdate, Text, User } = comment;
          const { canEdit, canRemove } = commentActions({ comment, currentUserId, commentsEdit, commentsRemove });

          return (
            <div key={ID || index} className={styles.commentItem}>
              <div className={styles.commentItemHeader}>
                <UserRow User={User} LastUpdate={LastUpdate} />
                {ID && (
                  <div className={styles.commentItemActions}>
                    <CommentActionsMenu
                      canEdit={canEdit}
                      canRemove={canRemove}
                      onEdit={() => setEditing({ ID, Text, resourceKey })}
                      onRemove={() => setPendingRemoval({ ID, LastUpdate, Text, User })}
                      // Opening a menu re-checks the series grant, so a revocation since the
                      // panel opened is reflected before the user picks an action.
                      onOpen={() => resolveSeriesAcl({ force: true })}
                    />
                  </div>
                )}
              </div>
              {editing?.ID === ID ? renderEditForm(comment) : (
                <div className={styles.commentItemText}>
                  <ReactMarkdown>{Text}</ReactMarkdown>
                </div>
              )}
            </div>
          );
        })
      ) : (
        <NoCommentsPlaceholder studyId={studyId} />
      )}

      {commentsEdit && (
        <div className={styles.commentsNewCommentForm}>
          <textarea
            ref={composeRef}
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
      )}

      {pendingRemoval && (
        <RemoveResourceConfirm
          kind="comment"
          descriptor={pendingRemoval}
          isRemoving={isRemoving}
          fallbackFocusRef={composeRef}
          onConfirm={handleConfirmRemove}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
      
    </div>
  );
}


Comments.propTypes = {
  series: PropTypes.object,
  // Set to show the study's own comments; unset to show the comments of `series`.
  studyId: PropTypes.string,
  // The study the panel belongs to, in either mode; permissions resolve against it.
  studyInstanceUID: PropTypes.string,
};
