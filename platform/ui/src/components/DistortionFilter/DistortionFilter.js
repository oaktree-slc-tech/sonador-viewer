import _ from 'lodash';

import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import OHIF, { sonador, redux } from '@ohif/core';

import Icon from '../../elements/Icon/Icon.js';
import SelectTree from '../selectTree/SelectTree.js';
import LabellingTransition from '../Labelling/LabellingTransition';


const DistortionFilterFlow = ({
  // React component which provides a "workflow" to execute Distortion Filter tests against the
  // Sonador / Orthanc API. Use as part of the Measurements / Annotations substem of OHIF.

  // Workflow steps:
  // * Step 1: Load list of available groups
  // * Step 2: After a group is selected, execute a call to the Sonador API to check the
  //   the loaded study DICOM tag values against those entered under the Distortion Filter
  //   test values for the group.

  server,
  groups,
  StudyInstanceUID,
  UINotificationService,
  distortionFilterDoneCallback,
  groupSelectTitle = 'Select Group Device List for Distortion Check',
  groupSearchPlaceholder = 'Search groups',
  fadeOutTimeout = 2000,
  msgTemplate = _.template('<%= group %>/<%= device %> ("<%= deviceModel %>"): <%= msg %>'),
  userNotificationTitleTemplate = _.template('Distortion Filter results for "<%= group %>"'),
  userNotificationMsgTemplate = _.template(
    'Results for Study="<%= studyId %>": checked <%= seriesCount %> series. <%= findingsCount %> findings.'),
  ...props
}) => {
  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const [fadeOutTimer, setFadeOutTimer] = useState();
  const [showComponent, setShowComponent] = useState(true);

  // DisplaySet API
  const displaySetApi = OHIF.display.DisplaySetApi.Instance;  

  // Clear workflow widget
  const fadeOutAndLeave = () => setFadeOutTimer(setTimeout(fadeOutAndLeaveFast, fadeOutTimeout));
  const fadeOutAndLeaveFast = () => setShowComponent(false);

  const clearFadeOutTimer = () => {
    if (fadeOutTimer) {
      clearTimeout(fadeOutTimer);
      setFadeOutTimer(null);
    }
  };

  // Manage state for group selection
  const [selectedGroup, setSelectedGroup] = useState(null);

  // Prompt user to select group for which the device filter should be applied
  const displayGroups = _.map(groups, g => {
    return { label: g.name, value: _.toString(g.id) }
  });

  const onGroupSelected = (evt, group) => {
    // Set selected group for the workflow

    setSelectedGroup({ id: group.value, name: group.label });
    setShowComponent(false);
  }

  useEffect(() => {
    // Execute distortion filter
    if (selectedGroup) {
      
      sonador.distortionFilter.getDistortionCheck(activeServer, selectedGroup, StudyInstanceUID).then((res) => {
        let filterNotification = false;
        let filterMessageCount = 0;

        _.keys(res).forEach(seriesId => {

          _.each(displaySetApi.displaySetService.getDisplaySetsForSeries(seriesId), (ds) => {

            // Add distortion filter properties to the displaySet
            ds.distortionFilterCheck = true;
            const _distortionFilterResults = ds.distortionFilterResults || {};
            const _groupDistortionFilterResults = (res[seriesId] && res[seriesId].results || []);
            _distortionFilterResults[selectedGroup.id] = _groupDistortionFilterResults;

            // Check client warnings to determine if distortion filter check errors
            // have been incorporated.
            const _clientWarnings = [...(ds.clientWarnings || [])];
            _.each(_groupDistortionFilterResults, (_r) => {

              // Add distortion filter results to client warnings
              if ((_r.Message || _r.Error || _r.Result != 'Ignore') && !_clientWarnings.find((m) => (m || '').includes(_r.DeviceUID))) {
                _clientWarnings.push(msgTemplate({
                  group: selectedGroup.name,
                  device: _r.DeviceUID, deviceModel: _r.DeviceModel,
                  msg: _r.Error || _r.Message || _r.Result,
                }));

                // Notify user of device filter results
                filterNotification = true;
                filterMessageCount += 1;
              }

            });

            // Update display set data
            ds.distortionFilterResults = _distortionFilterResults;
            ds.clientWarnings = _clientWarnings;
            displaySetApi.displaySetService.addDisplaySets([ds]);
          });
        });

        // Notify user of results
        UINotificationService.show({
          title: userNotificationTitleTemplate({ group: selectedGroup.name, }),
          message: userNotificationMsgTemplate({
            studyId: _.truncate(StudyInstanceUID, { length: 16, }),
            seriesCount: _.keys(res).length, findingsCount: filterMessageCount
          }),
          type: !filterNotification ? 'success' : 'warning',
        });
      });
    }

  }, [selectedGroup]);

  return (
    <LabellingTransition displayComponent={showComponent} onTransitionExit={distortionFilterDoneCallback}>
    <>
      <div onMouseLeave={fadeOutAndLeave} onMouseEnter={clearFadeOutTimer}>
        <SelectTree
          items={displayGroups}
          columns={1}
          onSelected={onGroupSelected}
          searchPlaceholder={groupSearchPlaceholder}
          selectTreeFirstTitle={groupSelectTitle}
          selectTreeFirstTitme={groupSearchPlaceholder}
        />
      </div>
    </>
    </LabellingTransition>
  );
};


DistortionFilterFlow.propTypes = {
  server: PropTypes.object.isRequired,
  groups: PropTypes.array.isRequired,
  StudyInstanceUID: PropTypes.string.isRequired,
  UINotificationService: PropTypes.object.isRequired,
  distortionFilterDoneCallback: PropTypes.func.isRequired,
  groupSelectTitle: PropTypes.string,
  groupSearchPlaceholder: PropTypes.string,
  fadeOutTimeout: PropTypes.number,
  msgTemplate: PropTypes.func.isRequired,
  userNotificationTitleTemplate: PropTypes.func.isRequired,
  userNotificationMsgTemplate: PropTypes.func.isRequired,
}




export default DistortionFilterFlow;
export { DistortionFilterFlow };
