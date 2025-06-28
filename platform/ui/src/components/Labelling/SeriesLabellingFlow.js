import React, { useEffect, useRef, useState } from 'react';
import * as _ from 'lodash';
import PropTypes from 'prop-types';

import { sonador } from '@ohif/core';

import Icon from '../../elements/Icon/Icon.js';
import SelectTree from '../selectTree/SelectTree.js';

import LabellingFlow from './LabellingFlow.js';


const SeriesTagLabellingFlow = ({
  // React component that provides a "workflow" to apply series tags. Used as part
  // of the Measurements / Annotations subsystem of OHIF.

  //  Workflow steps:
  //  * Step 0: Retrieve groups list and prompt user to select one.
    //  * Step 1: Retrieve tags from server and render using th LabellingFlow component.
    //  * Step 2: When an item is selected from the dropdown list, proceed to a "confirm" dialog
    //    which shows the selected label and provides the option to create a description.
    //  * Step 3: Once label/tag and description are confirmed, the annotation can be confirmed
    //    by clicking on an "Accept" button.

  groups,
  server,
  groupSelectTitle,
  groupSearchPlaceholder,
  ...props
}) => {
  // Manage state for group selection
  const [selectedGroup, setSelectedGroup] = useState(undefined);
  const [seriesTags, setSeriesTags] = useState([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);

  useEffect(() => {
    
    // Fetch series tags
    if (selectedGroup && !seriesTags.length) {
      sonador.fetchGroupTags(server, selectedGroup).then((res) => res.json()).then((res)=> {        

        if (res.length) {
          
          // Add tags to component state
          setSeriesTags(_.map(res, t => {
            return { label: t.Meaning, value: t.Value, group: selectedGroup };
          }));
        } else {

          // No tags found in the 
          if (props.labellingCanceledCallback) {
            props.labellingCanceledCallback({ tags: res, group: selectedGroup, });
          }
        }
      });
    }

    // After tags have been fetched, load next stage of the workflow
    if (selectedGroup && seriesTags.length) {
      setTagsLoaded(true);
    }
  }, [selectedGroup, seriesTags, tagsLoaded]);

  const onGroupSelected = (evt, group) => {
    // Set selected grop for the workflow
    
    setSelectedGroup({ id: group.value, name: group.label, });
  }

  if (!tagsLoaded && groups.length == 1) {

    // Only one group with tags enabled, set as active and trigger tags workflow
    setTimeout(() => setSelectedGroup(groups[0]), 100);
    return (
        <div className="loading" />
    );
  } else if (tagsLoaded && seriesTags.length) {

    // Load labelling workflow    
    return (
      <LabellingFlow
        {...props}
        labelData={seriesTags}
      />
    );
  } else {

    // Prompt user to select group for which the tags should be retrieved
    const displayGroups = _.map(groups, g => {
      return { label: g.name, value: _.toString(g.id) };
    });

    return (
      <SelectTree
        items={displayGroups}
        columns={1}
        onSelected={onGroupSelected}
        selectTreeFirstTitle={groupSelectTitle}
        searchPlaceholder={groupSearchPlaceholder}
      />
    );
  }
};


SeriesTagLabellingFlow.propTypes = {
  ...LabellingFlow.propTypes,
  server: PropTypes.object.isRequired,
  groups: PropTypes.array.isRequired,
  groupSelectTitle: PropTypes.string,
  labellingCanceledCallback: PropTypes.func.isRequired,
}


SeriesTagLabellingFlow.defaultProps = {
  ...LabellingFlow.defaultProps,
  groupSelectTitle: 'Select Group',
  groupSearchPlaceholder: 'Search groups',
  fadeOutTimeout: 2000,
}


export default SeriesTagLabellingFlow;