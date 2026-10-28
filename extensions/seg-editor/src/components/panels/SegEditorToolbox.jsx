// The Segmentation Editor's toolbox: OHIF v3's Toolbox (extensions/cornerstone/src/utils/Toolbox.tsx)
// without its collapsible section. The palettes sit inside the Segmentation Editor section of the
// panel, which collapses them together with the segment list; a second level of collapsing would
// only hide the tools. The inner markup is the Toolbox's, so the palette's styling applies. The
// active tool's options are drawn as cards (ToolOptionCards) rather than with v3's ToolSettings.

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import { useActiveToolOptions, useSystem, useToolbar } from '@ohif/core';
import { Button, Icons } from '@ohif/ui-next';

import ToolOptionCards from '../../toolbarComponents/ToolOptionCards';


export default function SegEditorToolbox({ buttonSectionId, title, titleAction = null, status = null }) {
  const { servicesManager } = useSystem();
  const { t } = useTranslation();

  const { toolbarService, customizationService } = servicesManager.services;
  const [showConfig, setShowConfig] = useState(false);

  const { toolbarButtons: toolboxSections, onInteraction } = useToolbar({
    buttonSection: buttonSectionId,
  });
  const { activeToolOptions, activeToolButtonId } = useActiveToolOptions({ buttonSectionId });
  const activeToolLabel = activeToolButtonId
    ? toolbarService.getButtonProps(activeToolButtonId)?.label
    : undefined;

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
      {/* The segmentation header's row (SonadorSegmentationHeader): a leading action slot, the
          label, a trailing action slot, each slot present whether or not it holds a control, so
          the label sits where the header's does (owner's review of 2026-10-27: be consistent) */}
      <div className="seg-editor-toolbox-title text-foreground flex w-full items-center justify-between">
        <div className="flex items-center">
          {titleAction ?? <span className="seg-action ml-1 inline-block w-6" aria-hidden="true" />}
        </div>
        <div className="flex min-w-0 items-center">
          <span className="seg-label ml-2 truncate pl-1.5 pr-1.5">{t(title)}</span>
        </div>
        <div className="ml-1 mr-1 flex items-center">
          {CustomConfigComponent ? (
            <Button variant="ghost" size="icon" className="seg-action" aria-label={t('Settings', { ns: 'SegmentationEditor' })} onClick={() => setShowConfig(!showConfig)}>
              <Icons.Settings className="h-4 w-4" />
            </Button>
          ) : (
            <span className="seg-action inline-block w-6" aria-hidden="true" />
          )}
        </div>
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
        {status && <div className="bg-muted px-2">{status}</div>}
        {activeToolOptions && (
          <div className="bg-muted mt-1 h-auto px-2">
            <ToolOptionCards title={activeToolLabel} options={activeToolOptions} />
          </div>
        )}
      </div>
    </div>
  );
}

SegEditorToolbox.propTypes = {
  buttonSectionId: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  /** A menu before the title, as the kit's segmentation header leads with its menu (the 3D palette's Model Actions) */
  titleAction: PropTypes.node,
  /** A block under the tool row, shown with every tool (the 3D palette's surface status) */
  status: PropTypes.node,
};
