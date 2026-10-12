// The Segmentation Editor's toolbox: OHIF v3's Toolbox (extensions/cornerstone/src/utils/Toolbox.tsx)
// without its collapsible section. The palettes sit inside the Segmentation Editor section of the
// panel, which collapses them together with the segment list; a second level of collapsing would
// only hide the tools. The inner markup is the Toolbox's, so the palette's styling applies.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { useActiveToolOptions, useSystem, useToolbar } from '@ohif/core';
import { Icons, ToolSettings } from '@ohif/ui-next';


export default function SegEditorToolbox({ buttonSectionId, title }) {
  const { servicesManager } = useSystem();
  const { t } = useTranslation();

  const { toolbarService, customizationService } = servicesManager.services;
  const [showConfig, setShowConfig] = useState(false);

  const { toolbarButtons: toolboxSections, onInteraction } = useToolbar({
    buttonSection: buttonSectionId,
  });
  const { activeToolOptions } = useActiveToolOptions({ buttonSectionId });

  if (!toolboxSections.length) {
    return null;
  }
  if (!toolboxSections.every(section => section.componentProps.buttonSection)) {
    throw new Error(
      'SegEditorToolbox accepts only button sections at the top level, not buttons. Create at least one button section.'
    );
  }

  const handleInteraction = ({ itemId }) => {
    onInteraction?.({ itemId });
  };

  const CustomConfigComponent = customizationService.getCustomization(`${buttonSectionId}.config`);

  return (
    <div className="seg-editor-toolbox" data-cy={`seg-editor-toolbox-${buttonSectionId}`}>
      <div className="seg-editor-toolbox-title flex w-full items-center justify-between">
        <span>{t(title)}</span>
        {CustomConfigComponent && (
          <div className="ml-auto mr-2">
            <Icons.Settings
              className="text-primary h-4 w-4"
              onClick={() => setShowConfig(!showConfig)}
            />
          </div>
        )}
      </div>

      <div className="bg-muted flex-shrink-0 border-none">
        {showConfig && <CustomConfigComponent />}
        {toolboxSections.map(section => {
          const sectionId = section.componentProps.buttonSection;
          const buttons = toolbarService.getButtonSection(sectionId);

          return (
            <div key={sectionId} className="bg-muted flex flex-wrap gap-2 py-2 px-1">
              {buttons.map(tool => {
                if (!tool || !tool.componentProps.visible) {
                  return null;
                }
                const { id, Component, componentProps } = tool;

                return (
                  <div key={id}>
                    <Component
                      {...componentProps}
                      id={id}
                      onInteraction={handleInteraction}
                      size="toolbox"
                      servicesManager={servicesManager}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
        {activeToolOptions && (
          <div className="bg-muted mt-1 h-auto px-2">
            <ToolSettings options={activeToolOptions} />
          </div>
        )}
      </div>
    </div>
  );
}

SegEditorToolbox.propTypes = {
  buttonSectionId: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
};
