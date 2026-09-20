// Which actions the signed-in user gets on a comment (imaging-development-env#99).
//
// Pure, so the rule is testable without a renderer. Mirrors the server's rule: comment_edit
// covers a user's own comments (edit and remove); the resource `remove` grant removes anyone's.


export const isCommentAuthor = (comment, currentUserId) => {
  // Sonador user ids on both sides. Unknown on either side means "not yours": the menu must not
  // offer an edit the server will refuse.
  const authorId = comment?.User?.id;

  return authorId !== undefined && authorId !== null
    && currentUserId !== undefined && currentUserId !== null
    && String(authorId) === String(currentUserId);
};


export const commentActions = ({ comment, currentUserId, commentsEdit = false, commentsRemove = false }) => {
  const own = isCommentAuthor(comment, currentUserId);

  return {
    canEdit: !!(commentsEdit && own),
    canRemove: !!((commentsEdit && own) || commentsRemove),
  };
};
