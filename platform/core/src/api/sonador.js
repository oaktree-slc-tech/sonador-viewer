import _ from 'lodash';
import user from '../user.js';
import { urlUtil } from '../utils';


const getAuthToken = () => user && user.getAccessToken && user.getAccessToken();


const sonadorUrl = (resource) => {
  // Create a fully qualified domain resource (FQDN) URL for the provided path. If the URL
  // is a relative URL, it will be combined with the Sonador connection host (taken from the)
  // global window variable to transform it to a complete URL.

  // @returns URL

  // Ensure that window.sonador.host is defined
  if (!window || !window.sonador || !window.sonador.host) {
    throw new Error('Unable to retrieve Sonador host, window.sonador.host is not defined.');
  }

  return new URL(resource, window.sonador.host);
};


const getActiveServer = (servers) => {
	// Retrieve the currently image server for the viewer

	// Unpack servers to flat array. The server state structure is a nested object
	// that needs to be unpacked.
	if (_.isObject(servers) && servers.servers) {
		servers = servers.servers;
	}

	if (!_.isArray(servers)) {
		throw Error('Unable to retrieve active server, server list is not an array');
	}

	return _.find((servers || []), _s => _s.active === true);
}


function searchImageServerGroups(server, search, group_query) {
	// 	Search user groups associated with the provided image server

	//	@input server (object): image server instance
	//	@input search_term (str): search term that should be used for the search
	//	@input group_query (object): query parameters to add to the search to help narrow results

	//	@returns Promise instance from fetch

	search = search || '';
	group_query = group_query || {};

	const _search = _.extend(group_query, {
		term: search,
	});

	return fetch(sonadorUrl(urlUtil.urlJoin('/visionaire/api/pacs', server.token, 'group/search')), {
		headers: { Authorization: `Bearer ${getAuthToken()}` },
		method: 'POST',
		body: JSON.stringify(_search),
	});
}


function fetchGroupTags(server, group) {
	// Retrieve group tags from the server

	// Ensure that the group is represented as an object. There are multiple places in OHIF
	// where must be represented in a primitive form. Coerce to API format before attempting
	// to retrieve data.
	if (_.isNumber(group) || _.isString(group)) {
		group = { id: group };
	}

	// Ensure that the server has a rootUrl property
	if (!server.rootUrl) {
		throw Error('Unable to retrieve tags for group, server instance does not have a root URL attribute');
	}

	return fetch(urlUtil.urlJoin(server.rootUrl, 'groups', _.toString(group.id), 'tags'), {
		headers: { Authorization: `Bearer ${getAuthToken()}` },
	});
}


export { sonadorUrl, getAuthToken, getActiveServer, searchImageServerGroups, fetchGroupTags };

