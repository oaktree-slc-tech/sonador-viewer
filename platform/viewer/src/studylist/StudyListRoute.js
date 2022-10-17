import * as _ from 'lodash';
import React, { useState, useEffect, useContext } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';
import { useTranslation } from 'react-i18next';
import { withRouter } from 'react-router-dom';

import OHIF from '@ohif/core';
import {
  StudyList,
  PageToolbar,
  TablePagination,
  useDebounce,
  useMedia,
} from '@ohif/ui';
import ConnectedHeader from '../connectedComponents/ConnectedHeader.js';
import * as RoutesUtil from '../routes/routesUtil';
// Google Health API
import ConnectedDicomFilesUploader from '../googleCloud/ConnectedDicomFilesUploader';
import filesToStudies from '../lib/filesToStudies.js';
// Sonador integration tools
import ImageServerPicker from '../sonador/ImageServerPicker.js';
// Contexts
import UserManagerContext from '../context/UserManagerContext';
import WhiteLabelingContext from '../context/WhiteLabelingContext';
import AppContext from '../context/AppContext';
// Studylist styling
import '../styles/global-viewer.css';
import './styles/studylist.css';

const { urlUtil: UrlUtil } = OHIF.utils;

function getStudyUrlParams() {
  // Retrieve the currently active query parameters
  let params = new URLSearchParams(location.search);
  return params;
}

function StudyListRoute(props) {
  // Sonador/OHIF Study List

  const { history, server, user, studyListFunctionsEnabled, filters } = props;

  let dcmfilters = filters || {};

  const [t] = useTranslation('Common');

  // ~~ STATE Properties

  const updateServerUrl = token => {
    // Update history to point at the most recent
    if (!(window.location.pathname || '').includes(token))
      history.push(
        RoutesUtil.parseStudyListPath(appConfig, server, {
          token: token,
        })
      );
  };

  // Study list table controls
  const [sort, setSort] = useState({
    fieldName: 'PatientName',
    direction: 'desc',
  });

  // Study list filter values
  const [filterValues, setFilterValues] = useState({
    // Study start/end dates
    studyDateTo: dcmfilters.studyDateTo
      ? decodeURIComponent(dcmfilters.studyDateTo)
      : '',
    studyDateFrom: dcmfilters.studyDateFrom
      ? decodeURIComponent(cmfilters.studyDateFrom)
      : '',

    // DICOM tags
    PatientName: dcmfilters.PatientName
      ? decodeURIComponent(dcmfilters.PatientName)
      : '',
    PatientID: dcmfilters.PatientID
      ? decodeURIComponent(filters.PatientID)
      : '',
    AccessionNumber: dcmfilters.AccessionNumber
      ? decodeURIComponent(dcmfilters.AccessionNumber)
      : '',
    StudyDate: dcmfilters.StudyDate
      ? decodeURIComponent(dcmfilters.StudyDate)
      : '',
    modalities: dcmfilters.modalities
      ? decodeURIComponent(dcmfilters.modalities)
      : '',
    StudyDescription: dcmfilters.StudyDescription
      ? decodeURIComponent(dcmfilters.StudyDescription)
      : '',

    // patient and study (search multiple tags)
    patientNameOrId: dcmfilters.patientNameOrId
      ? decodeURIComponent(dcmfilters.patientNameOrId)
      : '',
    accessionOrModalityOrDescription: dcmfilters.accessionOrModalityOrDescription
      ? decodeURIComponent(dcmfilters.accessionOrModalityOrDescription)
      : '',

    // search all tags
    allFields: dcmfilters.allFields
      ? decodeURIComponent(dcmfilters.allFields)
      : '',
  });

  // Set study list
  const [studies, setStudies] = useState([]);

  // Study list state hooks
  const [activeModalId, setActiveModalId] = useState(null);
  const [searchStatus, setSearchStatus] = useState({
    isSearchingForStudies: false,
    error: null,
  });

  // Manage pagination
  const [rowsPerPage, setRowsPerPage] = useState(
    (dcmfilters || {}).items ? parseInt(filters.items) : 25
  );
  const [pageNumber, setPageNumber] = useState(
    (dcmfilters || {}).page ? parseInt(filters.page) - 1 : 0
  );

  const updateRowsPerPage = rows => {
    // Update the number of rows per page, synchronize state and URL

    let params = getStudyUrlParams();
    params.set('items', rows);
    history.push({ search: params.toString() });

    setRowsPerPage(rows);
  };

  const updatePageNumber = pnumber => {
    // Update the page number, synchronize state and URL
    let params = getStudyUrlParams();
    params.set('page', pnumber + 1);
    history.push({ search: params.toString() });

    setPageNumber(pnumber);
  };

  const appContext = useContext(AppContext);

  // ~~ RESPONSIVE
  const displaySize = useMedia(
    [
      '(min-width: 1750px)',
      '(min-width: 1000px) and (max-width: 1749px)',
      '(max-width: 999px)',
    ],
    ['large', 'medium', 'small'],
    'small'
  );

  // ~~ DEBOUNCED INPUT
  const debouncedSort = useDebounce(sort, 200);
  const debouncedFilters = useDebounce(filterValues, 500);

  const { appConfig = {} } = appContext;

  // Called when relevant state/props are updated
  // Watches filters and sort, debounced
  useEffect(
    () => {
      const fetchStudies = async () => {
        try {
          setSearchStatus({ error: null, isSearchingForStudies: true });

          const response = await getStudyList(
            server,
            debouncedFilters,
            debouncedSort,
            rowsPerPage,
            pageNumber,
            displaySize,
            history
          );

          setStudies(response);
          setSearchStatus({ error: null, isSearchingForStudies: false });
        } catch (error) {
          console.warn(error);
          setSearchStatus({ error: true, isFetching: false });
        }
      };

      // Users must have the "query" permission in order to execute searches
      // against Sonador Imaging servers
      if (server && server.perms && server.perms.query) {
        fetchStudies();
      }
    },

    // TODO: Can we update studies directly?
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      debouncedFilters,
      debouncedSort,
      rowsPerPage,
      pageNumber,
      displaySize,
      server,
    ]
  );

  // TODO: Update Server
  // if (this.props.server !== prevProps.server) {
  //   this.setState({
  //     modalComponentId: null,
  //     searchData: null,
  //     studies: null,
  //   });
  // }

  const onDrop = async acceptedFiles => {
    try {
      const studiesFromFiles = await filesToStudies(acceptedFiles);
      setStudies(studiesFromFiles);
    } catch (error) {
      setSearchStatus({ isSearchingForStudies: false, error });
    }
  };

  if (searchStatus.error) {
    return <div>Error: {JSON.stringify(searchStatus.error)}</div>;
  } else if (studies === [] && !activeModalId) {
    return <div>Loading...</div>;
  }

  let healthCareApiButtons = null;
  let healthCareApiWindows = null;

  // Switch Sonador Server
  // updateURL(isModalOpen, appConfig, server, history);

  function handleSort(fieldName) {
    let sortFieldName = fieldName;
    let sortDirection = 'asc';

    if (fieldName === sort.fieldName) {
      if (sort.direction === 'asc') {
        sortDirection = 'desc';
      } else {
        sortFieldName = null;
        sortDirection = null;
      }
    }

    setSort({
      fieldName: sortFieldName,
      direction: sortDirection,
    });
  }

  function handleFilterChange(fieldName, value) {
    // Fetch study list on filter change

    setFilterValues(state => {
      return {
        ...state,
        [fieldName]: value,
      };
    });
  }

  return (
    <>
      {/*  DICOM Upload Modal: Enabled if the user has been granted the "upload" 
        permission for the server */}
      {studyListFunctionsEnabled &&
      server &&
      server.perms &&
      server.perms.upload ? (
        <ConnectedDicomFilesUploader
          isOpen={activeModalId === 'DicomFilesUploader'}
          onClose={() => setActiveModalId(null)}
        />
      ) : null}
      {healthCareApiWindows}
      <WhiteLabelingContext.Consumer>
        {whiteLabeling => (
          <UserManagerContext.Consumer>
            {userManager => (
              <ConnectedHeader
                useLargeLogo={true}
                user={user}
                userManager={userManager}
              >
                {whiteLabeling &&
                  whiteLabeling.createLogoComponentFn &&
                  whiteLabeling.createLogoComponentFn(React)}
              </ConnectedHeader>
            )}
          </UserManagerContext.Consumer>
        )}
      </WhiteLabelingContext.Consumer>

      {/* Study Header: Search/Filter/Upload */}
      {server ? (
        <div className="study-list-header">
          <div className="header">
            <h1
              style={{
                fontWeight: 300,
                fontSize: '22px',
                paddingTop: '0.25rem',
              }}
            >
              <ImageServerPicker
                activeServer={server}
                user={user}
                onServerChange={updateServerUrl}
              />

              {/* Study list: requires "query permission" */}
              {server.perms && server.perms.query ? (
                <span className="sonador-studylistt-title">
                  <span className="sonador-gold spacer-left-05rem spacer-right-05rem hide-xs">
                    /
                  </span>
                  <span className="hide-xs">{t('Study List')}</span>
                </span>
              ) : null}
            </h1>
          </div>

          {/* Toolbar Buttons */}
          <div className="actions">
            {studyListFunctionsEnabled && healthCareApiButtons}

            {/* DICOM Upload Button: requires "upload" permission */}
            {studyListFunctionsEnabled &&
              server.perms &&
              server.perms.upload && (
                <PageToolbar
                  onImport={() => setActiveModalId('DicomFilesUploader')}
                />
              )}

            {/* DICOM Query Results: requires "query" permission */}
            {server.perms && server.perms.query && (
              <span>
                <span className="study-count">{studies.length}</span>
                <span className="sonador-lightgray spacer-left-05rem font-light fontsize-medium hide-xs">
                  {t('Studies')}
                </span>
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* Study List Table Background */}
      {server && server.perms && server.perms.query ? (
        <div className="table-head-background" />
      ) : null}

      {/* Study List: requires "query permission" */}
      {server && server.perms && server.perms.query ? (
        <div className="study-list-container">
          <StudyList
            isLoading={searchStatus.isSearchingForStudies}
            hasError={searchStatus.error === true}
            // Rows
            studies={studies}
            onSelectItem={studyInstanceUID => {
              const viewerPath = RoutesUtil.parseViewerPath(appConfig, server, {
                studyInstanceUIDs: studyInstanceUID,
              });
              history.push(viewerPath);
            }}
            // Table Header
            sort={sort}
            onSort={handleSort}
            filterValues={filterValues}
            onFilterChange={handleFilterChange}
            studyListDateFilterNumDays={appConfig.studyListDateFilterNumDays}
            displaySize={displaySize}
          />

          {/* Footer: Pagination Controls */}
          <TablePagination
            currentPage={pageNumber}
            nextPageFunc={() => updatePageNumber(pageNumber + 1)}
            prevPageFunc={() => updatePageNumber(pageNumber - 1)}
            onRowsPerPageChange={updateRowsPerPage}
            rowsPerPage={rowsPerPage}
            recordCount={studies.length}
          />
        </div>
      ) : null}

      {/* Welcome Message (Empty State) */}
      {!server ? (
        <div className="notFound">
          <div className="study-list-header">
            <div className="header">
              <h1 className="state-message-large">{t('Welcome!')}</h1>
              <p className="state-message-large">
                {window.sonador.home.message}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

StudyListRoute.propTypes = {
  filters: PropTypes.object,
  PatientID: PropTypes.string,
  server: PropTypes.object,
  user: PropTypes.object,
  history: PropTypes.object,
  studyListFunctionsEnabled: PropTypes.bool,
};

StudyListRoute.defaultProps = {
  studyListFunctionsEnabled: true,
};

function updateURL(isModalOpen, appConfig, server, history) {
  // Update viewer URL and history
  if (isModalOpen) {
    return;
  }

  const listPath = RoutesUtil.parseStudyListPath(appConfig, server);

  if (UrlUtil.paramString.isValidPath(listPath)) {
    const { location = {} } = history;
    if (location.pathname !== listPath) {
      history.replace(listPath);
    }
  }
}

/**
 * Not ideal, but we use displaySize to determine how the filters should be used
 * to build the collection of promises we need to fetch a result set.
 *
 * @param {*} server
 * @param {*} filters
 * @param {object} sort
 * @param {string} sort.fieldName - field to sort by
 * @param {string} sort.direction - direction to sort
 * @param {number} rowsPerPage - Number of results to return
 * @param {number} pageNumber - Used to determine results offset
 * @param {string} displaySize - small, medium, large
 * @returns
 */
async function getStudyList(
  server,
  filters,
  sort,
  rowsPerPage,
  pageNumber,
  displaySize,
  history
) {
  const {
    allFields,
    patientNameOrId,
    accessionOrModalityOrDescription,
  } = filters;
  const sortFieldName = sort.fieldName || 'PatientName';
  const sortDirection = sort.direction || 'desc';

  const mappedFilters = {
    // DICOMweb advanced filters
    PatientID: filters.PatientID,
    PatientName: filters.PatientName,
    AccessionNumber: filters.AccessionNumber,
    StudyDescription: filters.StudyDescription,
    ModalitiesInStudy: filters.modalities,

    // NEVER CHANGE
    studyDateFrom: filters.studyDateFrom,
    studyDateTo: filters.studyDateTo,
    limit: rowsPerPage,
    offset: pageNumber * rowsPerPage,
    fuzzymatching: server.supportsFuzzyMatching === true,
  };

  // Add mapped filters to the search history
  let params = getStudyUrlParams();

  // Add mapped DICOM fields
  _.each(
    _.omit(
      mappedFilters,
      'studyDateFrom',
      'studyDateTo',
      'limit',
      'offset',
      'fuzzymatching'
    ),
    (v, k) => {
      if (_.isEmpty(v)) params.delete(k);
      else params.set(encodeURIComponent(k), encodeURIComponent(v));
    }
  );

  // Add compound fields
  _.each(
    {
      allFields: allFields,
      patientNameOrId: patientNameOrId,
      accessionOrModalityOrDescription: accessionOrModalityOrDescription,
    },
    (v, k) => {
      if (_.isEmpty(v)) params.delete(k);
      else params.set(encodeURIComponent(k), encodeURIComponent(v));
    }
  );

  // Update URL parameters if there is a change in the search
  if (params.toString() != location.search) {
    history.push({ search: params.toString() });
  }

  // Retrieve studies from server
  const studies = await _fetchStudies(server, mappedFilters, displaySize, {
    allFields,
    patientNameOrId,
    accessionOrModalityOrDescription,
  });

  // Only the fields we use
  const mappedStudies = studies.map(study => {
    const PatientName =
      typeof study.PatientName === 'string' ? study.PatientName : undefined;

    return {
      AccessionNumber: study.AccessionNumber, // "1"
      modalities: study.modalities, // "SEG\\MR"  ​​
      // numberOfStudyRelatedInstances: "3"
      // numberOfStudyRelatedSeries: "3"
      // PatientBirthdate: undefined
      PatientID: study.PatientID, // "NOID"
      PatientName, // "NAME^NONE"
      // PatientSex: "M"
      // referringPhysicianName: undefined
      StudyDate: study.StudyDate, // "Jun 28, 2002"
      StudyDescription: study.StudyDescription, // "BRAIN"
      // studyId: "No Study ID"
      StudyInstanceUID: study.StudyInstanceUID, // "1.3.6.1.4.1.5962.99.1.3814087073.479799962.1489872804257.3.0"
      // StudyTime: "160956.0"
    };
  });

  // For our smaller displays, map our field name to a single
  // field we can actually sort by.
  const sortFieldNameMapping = {
    allFields: 'PatientName',
    patientNameOrId: 'PatientName',
    accessionOrModalityOrDescription: 'modalities',
  };
  const mappedSortFieldName =
    sortFieldNameMapping[sortFieldName] || sortFieldName;

  const sortedStudies = _sortStudies(
    mappedStudies,
    mappedSortFieldName,
    sortDirection
  );

  // Because we've merged multiple requests, we may have more than
  // our Rows per page. Let's `take` that number from our sorted array.
  // This "might" cause paging issues.
  const numToTake =
    sortedStudies.length < rowsPerPage ? sortedStudies.length : rowsPerPage;
  const result = sortedStudies.slice(0, numToTake);

  return result;
}

/**
 *
 *
 * @param {object[]} studies - Array of studies to sort
 * @param {string} studies.StudyDate - Date in 'MMM DD, YYYY' format
 * @param {string} field - name of properties on study to sort by
 * @param {string} order - 'asc' or 'desc'
 * @returns
 */
function _sortStudies(studies, field, order) {
  // Make sure our StudyDate is in a valid format and create copy of studies array
  const sortedStudies = studies.map(study => {
    if (!moment(study.StudyDate, 'MMM DD, YYYY', true).isValid()) {
      study.StudyDate = moment(study.StudyDate, 'YYYYMMDD').format(
        'MMM DD, YYYY'
      );
    }
    return study;
  });

  // Sort by field
  sortedStudies.sort(function(a, b) {
    let fieldA = a[field];
    let fieldB = b[field];
    if (field === 'StudyDate') {
      fieldA = moment(fieldA).toISOString();
      fieldB = moment(fieldB).toISOString();
    }

    // Order
    if (order === 'desc') {
      if (fieldA < fieldB) {
        return -1;
      }
      if (fieldA > fieldB) {
        return 1;
      }
      return 0;
    } else {
      if (fieldA > fieldB) {
        return -1;
      }
      if (fieldA < fieldB) {
        return 1;
      }
      return 0;
    }
  });

  return sortedStudies;
}

/**
 * We're forced to do this because DICOMWeb does not support "AND|OR" searches
 * across multiple fields. This allows us to make multiple requests, remove
 * duplicates, and return the result set as if it were supported
 *
 * @param {object} server
 * @param {Object} filters
 * @param {string} displaySize - small, medium, or large
 * @param {string} multi.allFields
 * @param {string} multi.patientNameOrId
 * @param {string} multi.accessionOrModalityOrDescription
 */
async function _fetchStudies(
  server,
  filters,
  displaySize,
  { allFields, patientNameOrId, accessionOrModalityOrDescription }
) {
  let queryFiltersArray = [filters];

  if (displaySize === 'small') {
    const firstSet = _getQueryFiltersForValue(
      filters,
      [
        'PatientID',
        'PatientName',
        'AccessionNumber',
        'StudyDescription',
        'ModalitiesInStudy',
      ],
      allFields
    );

    if (firstSet.length) {
      queryFiltersArray = firstSet;
    }
  } else if (displaySize === 'medium') {
    const firstSet = _getQueryFiltersForValue(
      filters,
      ['PatientID', 'PatientName'],
      patientNameOrId
    );

    const secondSet = _getQueryFiltersForValue(
      filters,
      ['AccessionNumber', 'StudyDescription', 'ModalitiesInStudy'],
      accessionOrModalityOrDescription
    );

    if (firstSet.length || secondSet.length) {
      queryFiltersArray = firstSet.concat(secondSet);
    }
  }

  const queryPromises = [];

  queryFiltersArray.forEach(filter => {
    const searchStudiesPromise = OHIF.studies.searchStudies(server, filter);
    queryPromises.push(searchStudiesPromise);
  });

  const lotsOfStudies = await Promise.all(queryPromises);
  const studies = [];

  // Flatten and dedupe
  lotsOfStudies.forEach(arrayOfStudies => {
    if (arrayOfStudies) {
      arrayOfStudies.forEach(study => {
        if (!studies.some(s => s.StudyInstanceUID === study.StudyInstanceUID)) {
          studies.push(study);
        }
      });
    }
  });

  return studies;
}

/**
 *
 *
 * @param {*} filters
 * @param {*} fields - Array of string fields
 * @param {*} value
 */
function _getQueryFiltersForValue(filters, fields, value) {
  const queryFilters = [];

  if (value === '' || !value) {
    return queryFilters;
  }

  fields.forEach(field => {
    const filter = Object.assign(
      {
        PatientID: '',
        PatientName: '',
        AccessionNumber: '',
        StudyDescription: '',
        ModalitiesInStudy: '',
      },
      filters
    );

    filter[field] = value;
    queryFilters.push(filter);
  });

  return queryFilters;
}

export default withRouter(StudyListRoute);
