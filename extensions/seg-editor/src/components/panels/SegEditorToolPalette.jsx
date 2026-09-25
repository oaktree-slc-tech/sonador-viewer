import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import OHIF from '@ohif/core';
import { components as csextComponents } from '@ohif/extension-cornerstone';
import {
  Icons,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@ohif/ui-next';

import { SECTIONS, SEG_EDITOR_COMMAND_CONTEXT } from '../../toolbox/constants';

import styles from './SegEditorToolPalette.module.scss';

const { Toolbox } = csextComponents;
const { DisplaySetApi } = OHIF.display;


export const PALETTES = {
  labelmap: 'labelmap',
  threeD: '3d',
};

// Palette tabs are icons with a tooltip, as the OHIF v3 side panel tabs are. The Labelmap palette
// uses v3's segmentation-panel icon.
const PALETTE_TABS = [
  { value: PALETTES.labelmap, iconName: 'tab-segmentation', label: 'Labelmap Tools' },
  { value: PALETTES.threeD, iconName: 'layout-advanced-3d-only', label: '3D Tools' },
];

// OHIF v3 SidePanel tab styling (getTabClassNames / getTabIconClassNames)
const TAB_CLASSES =
  'text-foreground bg-primary/10 hover:bg-primary/20 hover:text-primary h-[28px] w-[68px] ' +
  'rounded-none p-0 first:rounded-l last:rounded-r data-[state=active]:shadow-none ' +
  'data-[state=active]:bg-primary/10';
const TAB_ICON_CLASSES =
  'flex h-full w-full items-center justify-center group-data-[state=active]:bg-primary/20 ' +
  'group-data-[state=active]:rounded';


function _initialPalette(displaySetInstanceUID, defaultPalette) {
  // Follow the editor's current mode, so a remounted panel matches what the 3D tab shows
  const displaySet = displaySetInstanceUID
    && DisplaySetApi.Instance.displaySetService.getDisplaySetByUID(displaySetInstanceUID);
  return displaySet?.segEditor3dEditingEnabled ? PALETTES.threeD : defaultPalette;
}


export default function SegEditorToolPalette({
    commandsManager, displaySetInstanceUID, defaultPalette = PALETTES.labelmap }) {
  // Segmentation Editor tool palettes (ohif-viewers#142), shown under the segment list: the
  // Labelmap (slice) tools, ported from the OHIF v3 segmentation toolbox, and the 3D tools, which
  // act on the 3D tab's editing canvas. Leaving a palette releases its tools: a labelmap tool
  // holding the primary mouse binding, or the active 3D tool.

  const { t } = useTranslation('SegmentationEditor');
  const [palette, setPalette] = useState(() => _initialPalette(displaySetInstanceUID, defaultPalette));

  const onPaletteChange = (value) => {
    if (value !== PALETTES.labelmap) {
      commandsManager.runCommand('deactivateLabelmapTools', {}, SEG_EDITOR_COMMAND_CONTEXT);
    }
    if (value !== PALETTES.threeD) {
      commandsManager.runCommand('deactivate3DTools', {}, SEG_EDITOR_COMMAND_CONTEXT);
    }

    // The 3D palette switches the 3D tab to the Three.js editing canvas
    commandsManager.runCommand('setSegEditor3DEditing', {
      enabled: value === PALETTES.threeD,
    }, SEG_EDITOR_COMMAND_CONTEXT);

    setPalette(value);
  };

  return (
    <div className={`seg-editor-palette ${styles.palette ?? ''}`}>
      <Tabs value={palette} onValueChange={onPaletteChange} className="w-full">
        <div className="bg-muted flex justify-center py-2">
          <TabsList className="h-auto gap-[2px] rounded-none bg-transparent p-0 hover:bg-transparent">
            {PALETTE_TABS.map(({ value, iconName, label }) => (
              <Tooltip key={value}>
                <TooltipTrigger asChild>
                  <TabsTrigger
                    value={value}
                    aria-label={t(label)}
                    data-cy={`seg-editor-palette-${value}`}
                    className={`group ${TAB_CLASSES}`}
                  >
                    <span className={TAB_ICON_CLASSES}>
                      <Icons.ByName
                        name={iconName}
                        className="text-primary"
                        style={{ width: '22px', height: '22px' }}
                      />
                    </span>
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t(label)}</TooltipContent>
              </Tooltip>
            ))}
          </TabsList>
        </div>

        <TabsContent value={PALETTES.labelmap} className="mt-0">
          <Toolbox buttonSectionId={SECTIONS.labelMapToolbox} title={t('Labelmap Tools')} />
        </TabsContent>

        <TabsContent value={PALETTES.threeD} className="mt-0">
          <Toolbox buttonSectionId={SECTIONS.threeDToolbox} title={t('3D Tools')} />
        </TabsContent>
      </Tabs>
    </div>
  );
}


SegEditorToolPalette.propTypes = {
  commandsManager: PropTypes.object.isRequired,
  displaySetInstanceUID: PropTypes.string,
  defaultPalette: PropTypes.oneOf(Object.values(PALETTES)),
};
