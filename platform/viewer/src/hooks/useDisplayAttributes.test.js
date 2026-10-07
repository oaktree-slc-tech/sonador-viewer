// The query keys and the enabled guard are pure; the hooks themselves need react-query's runtime.

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('../api/displayAttributes', () => ({ getDisplayAttributes: jest.fn(), getDisplayAttributeCollection: jest.fn() }));
jest.mock('../api/groups', () => ({ searchGroups: jest.fn(), groupSearchQueryKey: (server, filter, term) => ['groupSearch', server?.token || null, JSON.stringify(filter || {}), term || ''] }));

import {
  ENABLED_GROUPS_FILTER,
  canQueryDisplayAttributes,
  displayAttributeCollectionQueryKey,
  displayAttributesQueryKey,
} from './useDisplayAttributes';

describe('display attribute query keys', () => {
  it('namespace under displayAttributes and identify the server by token', () => {
    expect(displayAttributesQueryKey({ token: 'srv1', rootUrl: 'https://a' })).toEqual(['displayAttributes', 'srv1']);
    expect(displayAttributesQueryKey({ rootUrl: 'https://a' })).toEqual(['displayAttributes', 'https://a']);
    expect(displayAttributesQueryKey(undefined)).toEqual(['displayAttributes', null]);
  });

  it('nest the collection key under the aggregate key so one invalidation covers both', () => {
    const key = displayAttributeCollectionQueryKey({ token: 'srv1' }, 5);

    expect(key.slice(0, 2)).toEqual(displayAttributesQueryKey({ token: 'srv1' }));
    expect(key).toEqual(['displayAttributes', 'srv1', 'collection', 5]);
    expect(displayAttributeCollectionQueryKey({ token: 'srv1' }, undefined)).toEqual(['displayAttributes', 'srv1', 'collection', null]);
  });

  it('never start with the study-list tags prefix', () => {
    expect(displayAttributesQueryKey({ token: 'x' })[0]).not.toBe('tags');
  });

  it('search enabled groups by the display_attr policy flag only', () => {
    expect(ENABLED_GROUPS_FILTER).toEqual({ display_attr: true });
  });
});

describe('canQueryDisplayAttributes', () => {
  it('requires a plugin root URL', () => {
    expect(canQueryDisplayAttributes({ rootUrl: 'https://a' })).toBe(true);
    expect(canQueryDisplayAttributes({ token: 'x' })).toBe(false);
    expect(canQueryDisplayAttributes(null)).toBe(false);
  });
});
