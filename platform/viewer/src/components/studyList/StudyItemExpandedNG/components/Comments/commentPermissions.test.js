import { commentActions, isCommentAuthor } from './commentPermissions';

const MINE = { ID: 'c1', User: { id: 36, username: 'me' } };
const THEIRS = { ID: 'c2', User: { id: 13, username: 'someone' } };
const ANONYMOUS = { ID: 'c3' };


describe('isCommentAuthor', () => {
  it('matches on the Sonador user id, tolerating string/number mismatch', () => {
    expect(isCommentAuthor(MINE, 36)).toBe(true);
    expect(isCommentAuthor(MINE, '36')).toBe(true);
    expect(isCommentAuthor(THEIRS, 36)).toBe(false);
  });

  it('is false when either side is unknown', () => {
    expect(isCommentAuthor(ANONYMOUS, 36)).toBe(false);
    expect(isCommentAuthor(MINE, undefined)).toBe(false);
    expect(isCommentAuthor(MINE, null)).toBe(false);
    expect(isCommentAuthor(undefined, 36)).toBe(false);
  });
});


describe('commentActions', () => {
  it('comment_edit on my own comment: edit and remove', () => {
    expect(commentActions({ comment: MINE, currentUserId: 36, commentsEdit: true })).toEqual({ canEdit: true, canRemove: true });
  });

  it("comment_edit alone on someone else's comment: nothing", () => {
    expect(commentActions({ comment: THEIRS, currentUserId: 36, commentsEdit: true })).toEqual({ canEdit: false, canRemove: false });
  });

  it("resource remove on someone else's comment: remove but not edit", () => {
    expect(commentActions({ comment: THEIRS, currentUserId: 36, commentsEdit: true, commentsRemove: true }))
      .toEqual({ canEdit: false, canRemove: true });
    expect(commentActions({ comment: THEIRS, currentUserId: 36, commentsEdit: false, commentsRemove: true }))
      .toEqual({ canEdit: false, canRemove: true });
  });

  it('no comment_edit on my own comment: remove only with the resource grant', () => {
    expect(commentActions({ comment: MINE, currentUserId: 36, commentsEdit: false })).toEqual({ canEdit: false, canRemove: false });
    expect(commentActions({ comment: MINE, currentUserId: 36, commentsEdit: false, commentsRemove: true }))
      .toEqual({ canEdit: false, canRemove: true });
  });

  it('unknown identity offers nothing beyond the resource grant', () => {
    expect(commentActions({ comment: MINE, currentUserId: undefined, commentsEdit: true })).toEqual({ canEdit: false, canRemove: false });
    expect(commentActions({ comment: MINE, currentUserId: undefined, commentsEdit: true, commentsRemove: true }))
      .toEqual({ canEdit: false, canRemove: true });
  });
});
