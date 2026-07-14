import { useQuery } from '@tanstack/react-query';
import { flatten, isUndefined } from 'lodash';

import DICOMWeb from '@ohif/core/src/DICOMWeb';

import { getWorklistGroup, getWorklistItems, getWorklistMembership } from '../api/worklist';
import { getDisplayName } from '../lib/getDisplayName';


export const useGroupSearch = (server, searchTerm) => {
  // Cache function the worklist group search
  
  return useQuery({
    queryKey: ['worklist', 'groupSearch', server, searchTerm],
    queryFn: () => getWorklistGroup(server, searchTerm),
  });
};


export const useGroupMembership = ({ server, groupId, term, enabled }) => {
  return useQuery({
    queryKey: ['worklist', 'groupMembership', server, groupId, term],
    queryFn: () => getWorklistMembership({ server, groupId, term }),
    enabled,
  });
};


const DISPLAY_TYPES = {
  'Code String': 'string',
  Date: 'date',
  Time: 'time',
  'Unique Identifier (UID)': 'string',
  'Integer String': 'string',
  'Decimal String': 'string',
  'Long Text': 'string',
  'Unsigned Short': 'string',
  'Person Name': 'string',
  'Long String': 'string',
  'Short String': 'string',
  'Sequence of Items': 'string',
  'Short Text': 'string',
  'Floating Point Double': 'string',
};


export const useWorklistItems = (params) => {
  return useQuery({
    queryKey: ['worklist', params],
    queryFn: () => getWorklistItems(params),
    select: (response) => {
      const mapped = Object.entries(params.tags || {})
        .filter(([key]) => key !== 'Instance')
        .map(([, value]) => Object.values(value));

      const requiredTags = flatten(mapped)
        .filter((filter) => filter.vr?.name !== 'Time') // TODO remove once time data is actual to display
        .reduce((acc, { code, tag, vr, options, label }) => {
          const type = options ? 'string' : DISPLAY_TYPES[vr?.name];

          return {
            ...acc,
            [code?.replace(',', '').toLowerCase()]: { type, value: tag, label },
          };
        }, {});

      return response.map((study) => {
        // Server-owned Requested Procedure lives in the worklist item's Meta (round-tripped from
        // the orthanc JSONB). Surface the reason/description so they can drive the table column
        // and the worklist viewer topbar.
        const requestedProcedure = study.Meta?.RequestedProcedure || {};
        const reasonForReview = {
          value: requestedProcedure.ReasonForTheRequestedProcedure,
          label: 'Reason for Review',
        };
        const requestedProcedureDescription = {
          value: requestedProcedure.RequestedProcedureDescription,
          label: 'Requested Procedure',
        };

        return Object.entries(study).reduce((acc, [key, value]) => {
          const res = requiredTags[key.toLowerCase()];

          if (key === '00080061') {
            return {
              ...acc,
              worklistId: study.ID,
              StudyInstanceUID: { value: DICOMWeb.getString(study['0020000D']) },
              AssignedUser: { value: getDisplayName(study.User), label: 'Assigned User', id: study.User.id },
              GroupName: { value: study.Group?.name, label: 'Group Name', id: study.Group.id },
              Status: { value: study.State },
              ReasonForReview: reasonForReview,
              RequestedProcedure: requestedProcedureDescription,
              PatientName: { value: DICOMWeb.getName(study['00100010']), label: 'Patient Name' },
              PatientID: { value: DICOMWeb.getName(study['00100020']), label: 'Patient Id' },
              PatientSex: { value: DICOMWeb.getName(study['00100040']), label: 'Patient Sex' },
              mrn: { value: DICOMWeb.getString(study['00100020']) },
              StudyDescription: { value: DICOMWeb.getString(study['00081030']), label: 'Study Description' },
              AccessionNumber: { value: DICOMWeb.getString(study['00080050']), label: 'Accession Number' },
              StudyDate: { value: DICOMWeb.getString(study['00080020']), label: 'Study Date', type: 'date' },
              id: study.ID,
              modalities: {
                value: DICOMWeb.getString(DICOMWeb.getModalities(study['00080060'], study['00080061'])),
                type: 'string',
                label: 'Modalities',
              },
            };
          }

          if (isUndefined(res?.value)) {
            return acc;
          }

          let property = Array.isArray(value.Value) ? value.Value[0] : value.Value;

          if (typeof property === 'object' && 'Alphabetic' in property) {
            property = property.Alphabetic;
          }

          return {
            ...acc,
            StudyInstanceUID: { value: DICOMWeb.getString(study['0020000D']) },
            AssignedUser: { value: getDisplayName(study.User), label: 'Assigned User', id: study.User.id },
            GroupName: { value: study.Group?.name, label: 'Group Name', id: study.Group.id },
            Status: { value: study.State },
            ReasonForReview: reasonForReview,
            RequestedProcedure: requestedProcedureDescription,
            PatientName: { value: DICOMWeb.getString(study['00100010']), label: 'Patient Name' },
            id: study.ID,
            mrn: { value: DICOMWeb.getString(study['00100020']) },
            StudyDescription: { value: DICOMWeb.getString(study['00081030']), label: 'Study Description' },
            AccessionNumber: { value: DICOMWeb.getString(study['00080050']), label: 'Accession Number' },
            StudyDate: { value: DICOMWeb.getString(study['00080020']), label: 'Study Date' },
            [res.value]: { type: res.type, value: property, label: res.label },
          };
        }, {});
      });
    },
  });
};
