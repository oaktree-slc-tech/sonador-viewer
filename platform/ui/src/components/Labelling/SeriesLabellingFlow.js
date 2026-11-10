import _ from 'lodash';

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';

import { displayAttributes, sonador } from '@ohif/core';

import Icon from '../../elements/Icon/Icon.js';
import SelectTree from '../selectTree/SelectTree.js';

import LabellingFlow from './LabellingFlow.js';
import LabellingTransition from './LabellingTransition.js';
import OHIFLabellingData from './OHIFLabellingData.js';
import { LabellingCloseButton, useEscapeKey, useModalPointerGuard } from './labellingDismiss.js';

import './LabellingFlow.css';


// Card colors for a picked tag. Background is the one the finding will be saved with (the tag's
// own, then the site and built-in defaults); Meaning is used only when the tag sets it itself.
const tagColor = tag => {
  const { SERIES_TAG_TOOL, getDisplayColor, resolveDisplayColor } = displayAttributes;
  const own = getDisplayColor(tag && tag.meta);
  return { Background: resolveDisplayColor(SERIES_TAG_TOOL, own).Background, Meaning: own.Meaning };
};

// A tag with a custom background (one that differs from the default display profile) is marked by
// a band of that color on the inside left edge of its option
const customBackgroundBand = meta => {
  const { SERIES_TAG_TOOL, getDisplayColor, resolveDisplayColor } = displayAttributes;
  const background = getDisplayColor(meta).Background;
  return background && background !== resolveDisplayColor(SERIES_TAG_TOOL).Background
    ? { boxShadow: `inset 5px 0 0 ${background}` }
    : undefined;
};


const SeriesTagLabellingFlow = ({
  // React component that provides a "workflow" to apply series tags. Used as part
  // of the Measurements / Annotations subsystem of OHIF.

  //  Workflow steps:
  //  * Step 0: Retrieve groups list and prompt user to select one.
  //  * Step 1: Retrieve tags from server and render using th LabellingFlow component.
  //  * Step 2: Selecting a tag applies it and shows LabellingFlow's card, where the anatomic
  //    location and a description can be added (each change applies when it is made).
  //  * Step 3: The check (Done) closes the flow; the close button and Escape also dismiss it.

  groups,
  server,
  groupSelectTitle = 'Select Group',
  groupSearchPlaceholder = 'Search groups',
  updateLabelling,
  labellingDoneCallback,
  anatomyData = OHIFLabellingData,
  ...props
}) => {
  const [showComponent, setShowComponent] = useState(true);
  // Closing (close button, Escape, check) removes the flow at once, without the exit fade
  const close = () => labellingDoneCallback();

  // Manage state for group selection
  const [selectedGroup, setSelectedGroup] = useState(undefined);
  const [seriesTags, setSeriesTags] = useState([]);
  const [tagsLoaded, setTagsLoaded] = useState(false);


  const onUpdateLabelling = (data) => {
    // Add group and other series attributes to labelling data

    // Add gropu, scheme, and schemeVersion to tag data
    if (data.value) {
      const t = seriesTags.find((_t) => _t.value == data.value);
      if (t) {
        _.extend(data, _.pick(t, 'group', 'scheme', 'schemeVersion', 'meta'));
      }
    }

    console.log('[ui:SeriesTagLabellingFlow:onUpdateLabelling] labelling data', data);
    updateLabelling(data);
  }

  useEffect(() => {
    
    // Fetch series tags
    if (selectedGroup && !seriesTags.length) {
      sonador.fetchGroupTags(server, selectedGroup).then((res) => res.json()).then((res)=> {   

        if (res.length) {
          
          // Add tags to component state
          setSeriesTags(_.map(res, t => {
            return {
              label: t.Meaning,
              value: t.Value,
              group: selectedGroup?.id ? selectedGroup.id : undefined,
              scheme: t.SchemeDesignator,
              schemeVersion: t.SchemeVersion,
              meta: t.Meta,
              labelStyle: customBackgroundBand(t.Meta),
            };
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

  // Only one group with tags enabled: select it and go straight to its tags
  useEffect(() => {
    if (!selectedGroup && groups.length == 1) {
      setSelectedGroup(groups[0]);
    }
  }, [groups, selectedGroup]);

  // Escape closes the group step; once the tags are shown, LabellingFlow handles it
  const inTagStep = tagsLoaded && seriesTags.length > 0;
  // The flow is modal: the viewports do not receive pointer input while it is open
  useModalPointerGuard();

  useEscapeKey(inTagStep ? null : close);

  const onGroupSelected = (evt, group) => {
    // Set selected grop for the workflow
    
    setSelectedGroup({ id: group.value, name: group.label, });
  }

  if (!tagsLoaded && groups.length == 1) {

    // Tags for the only group are loading
    return (
      <LabellingTransition displayComponent={showComponent} onTransitionExit={labellingDoneCallback}>
        <div className="labellingComponent" onKeyDown={event => event.stopPropagation()}>
          <LabellingCloseButton onClose={close} className="onCard" />
          <div className="loading" />
        </div>
      </LabellingTransition>
    );
  } else if (inTagStep) {

    // Load labelling workflow    
    return (
      <LabellingFlow
        {...props}
        labellingDoneCallback={labellingDoneCallback}
        labelData={seriesTags}
        updateLabelling={onUpdateLabelling}
        locationAttr='value'
        locationLabelAttr='text'
        labelWorkflowTitle='Assign Tag'
        relabelButtonTitle='Retag'
        searchPlaceholder='Search tags'
        anatomyData={anatomyData}
        anatomyAttr='location'
        labelColor={tagColor}
      />
    );
  } else {

    // Prompt user to select group for which the tags should be retrieved
    const displayGroups = _.map(groups, g => {
      return { label: g.name, value: _.toString(g.id) };
    });

    return (
      <LabellingTransition displayComponent={showComponent} onTransitionExit={labellingDoneCallback}>
        <>
        <div className="labellingComponent" onKeyDown={event => event.stopPropagation()}>
          <LabellingCloseButton onClose={close} className="onPicker" />
          <SelectTree
            items={displayGroups}
            columns={1}
            onSelected={onGroupSelected}
            selectTreeFirstTitle={groupSelectTitle}
            searchPlaceholder={groupSearchPlaceholder}
          />
        </div>
        </>
      </LabellingTransition>
    );
  }
};


SeriesTagLabellingFlow.propTypes = {
  ...LabellingFlow.propTypes,
  server: PropTypes.object.isRequired,
  groups: PropTypes.array.isRequired,
  groupSelectTitle: PropTypes.string,
  groupSearchPlaceholder: PropTypes.string,
  labellingCanceledCallback: PropTypes.func.isRequired,
}




export default SeriesTagLabellingFlow;