// Settings > General > Segmentation Editor: the editor's own preferences, on the settings page's
// row anatomy (SettingRowNG). Presentational: the state, hydration and Save are GeneralTabNG's.
// The rows are labelled by what they govern (Opening, Navigation, Pending edits, Mesh); a group
// gets a subheading only once it passes about five rows.

import React from 'react';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';

import SettingRowNG, { ColorRowNG, SwitchRowNG } from '../SettingRowNG/SettingRowNG';

// The swatch while the mesh follows the segment: the grey the editor falls back to without one
export const MESH_SWATCH_FALLBACK = '#8f8f8f';

export default function SegEditorSettingsTab({
  lockedModelsWarning,
  onLockedModelsWarningChange,
  followSelection,
  onFollowSelectionChange,
  previewColor,
  onPreviewColorChange,
  meshColorAuto,
  onMeshColorAutoChange,
  meshColor,
  onMeshColorPick,
}) {
  const { t } = useTranslation('UserPreferencesModal');
  const pickerText = { cancelText: t('ColorFieldCancel'), applyText: t('ColorFieldApply') };

  return (
    <>
      {/* Open as Segmentation's warning about locked models (ohif-viewers!92). The dialog's
          "Don't ask again" clears this; here is where it is turned back on. */}
      <SettingRowNG label={t('SegEditorOpening')} top>
        <SwitchRowNG
          id="locked-models-warning"
          label={t('LockedModelsWarningLabel')}
          help={t('LockedModelsWarningHelp')}
          hint={t('LockedModelsWarningHint')}
          checked={lockedModelsWarning}
          onCheckedChange={onLockedModelsWarningChange}
        />
      </SettingRowNG>
      <SettingRowNG label={t('SegEditorNavigation')} top>
        <SwitchRowNG
          id="seg-editor-follow-selection"
          label={t('SegEditorFollowSelectionLabel')}
          help={t('SegEditorFollowSelectionHelp')}
          hint={t('SegEditorFollowSelectionHint')}
          checked={followSelection}
          onCheckedChange={onFollowSelectionChange}
        />
      </SettingRowNG>
      <SettingRowNG label={t('SegEditorPreview')} top>
        <ColorRowNG
          id="seg-editor-preview-color"
          label={t('SegEditorPreviewColorLabel')}
          help={t('SegEditorPreviewColorHelp')}
          hint={t('SegEditorPreviewColorHint')}
          value={previewColor}
          onChange={onPreviewColorChange}
          {...pickerText}
        />
      </SettingRowNG>
      {/* One label, two controls: whether the mesh follows the segment, and the one colour it
          takes otherwise. The well is disabled, with its reason, while the box is ticked. */}
      <SettingRowNG label={t('SegEditorMesh')} top>
        <SwitchRowNG
          id="seg-editor-mesh-color-auto"
          label={t('SegEditorMeshColorAutoLabel')}
          hint={t('SegEditorMeshColorAutoHint')}
          checked={meshColorAuto}
          onCheckedChange={onMeshColorAutoChange}
        />
        <ColorRowNG
          id="seg-editor-mesh-color"
          label={t('SegEditorMeshColorLabel')}
          help={t('SegEditorMeshColorHelp')}
          hint={t('SegEditorMeshColorHint')}
          disabledHint={t('SegEditorMeshColorDisabledHint')}
          value={meshColor}
          disabled={meshColorAuto}
          fallback={MESH_SWATCH_FALLBACK}
          onChange={onMeshColorPick}
          {...pickerText}
        />
      </SettingRowNG>
    </>
  );
}

SegEditorSettingsTab.propTypes = {
  lockedModelsWarning: PropTypes.bool.isRequired,
  onLockedModelsWarningChange: PropTypes.func.isRequired,
  followSelection: PropTypes.bool.isRequired,
  onFollowSelectionChange: PropTypes.func.isRequired,
  /** '#rrggbb' */
  previewColor: PropTypes.string.isRequired,
  onPreviewColorChange: PropTypes.func.isRequired,
  meshColorAuto: PropTypes.bool.isRequired,
  onMeshColorAutoChange: PropTypes.func.isRequired,
  /** The well's colour: the pick in effect, or the last one while the mesh follows the segment */
  meshColor: PropTypes.string.isRequired,
  onMeshColorPick: PropTypes.func.isRequired,
};
