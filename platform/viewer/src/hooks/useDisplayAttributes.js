import { useQuery } from '@tanstack/react-query';

import { getDisplayAttributeCollection, getDisplayAttributes } from '../api/displayAttributes';
import { groupSearchQueryKey, searchGroups } from '../api/groups';

// Namespaced apart from useTags' `['tags', ...]` keys, which the study list invalidates.
export const DISPLAY_ATTRIBUTES_KEY = 'displayAttributes';

export const displayAttributesQueryKey = server => [DISPLAY_ATTRIBUTES_KEY, server?.token || server?.rootUrl || null];

export const displayAttributeCollectionQueryKey = (server, groupId) => [...displayAttributesQueryKey(server), 'collection', groupId ?? null];

export const canQueryDisplayAttributes = server => !!(server && server.rootUrl);

export const ENABLED_GROUPS_FILTER = Object.freeze({ display_attr: true });

/**
 * The groups whose display attributes the user may use and the de-duplicated union of their
 * attributes.
 */
export function useDisplayAttributes(server) {
  return useQuery({
    queryKey: displayAttributesQueryKey(server),
    queryFn: () => getDisplayAttributes(server),
    enabled: canQueryDisplayAttributes(server),
    staleTime: 60 * 1000,
  });
}

/**
 * One group's collection, with the permission flags the plugin reports for the caller.
 */
export function useDisplayAttributeCollection(server, groupId) {
  return useQuery({
    queryKey: displayAttributeCollectionQueryKey(server, groupId),
    queryFn: () => getDisplayAttributeCollection(server, groupId),
    enabled: canQueryDisplayAttributes(server) && groupId !== null && groupId !== undefined,
  });
}

/**
 * The server's groups whose policy enables display attributes, as the group search reports them
 * for the caller. Decides whether the Display Attributes editor is offered at all.
 */
export function useDisplayAttributeGroups(server) {
  return useQuery({
    queryKey: groupSearchQueryKey(server, ENABLED_GROUPS_FILTER, ''),
    queryFn: () => searchGroups(server, '', ENABLED_GROUPS_FILTER),
    enabled: !!(server && server.token),
    staleTime: 60 * 1000,
  });
}

export default useDisplayAttributes;
