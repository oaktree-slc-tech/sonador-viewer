import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import PropTypes from 'prop-types';

import { redux, uiNotificationService } from '@ohif/core';
import { mergeOverlayFieldOptions } from '@ohif/core/src/utils/overlayFields/mergeOptions';
import ModalNG from '@ohif/ui/src/components/ModalNG/ModalNG';
import { ReactComponent as SettingsIcon } from '@ohif/ui/src/elements/Svg/svgs/gear.svg';

import TabsNG from '../../components/TabsNG/TabsNG';
import { useDisplayAttributeGroups, useDisplayAttributes } from '../../hooks/useDisplayAttributes';
import useTags from '../../hooks/useTags';

import DisplayAttributesTab from './DisplayAttributesTab';
import ViewportDisplayTab from './ViewportDisplayTab';

import styles from './ViewerMetadataSettings.module.scss';

const TAB_VIEWPORT = 'viewport-display';
const TAB_ATTRIBUTES = 'display-attributes';

/**
 * Whether the Display Attributes editor is offered: the user may manage attributes (policy flag,
 * staff, or superuser) and at least one group on the server has them enabled. Otherwise the
 * section is the viewport display picker alone, with no tab strip.
 */
export function offersDisplayAttributes(perms, enabledGroups) {
  const canManage = !!(perms && (perms.display_attr_modify || perms.is_superuser || perms.is_staff));
  return canManage && Array.isArray(enabledGroups) && enabledGroups.length > 0;
}

/**
 * The Viewer Metadata section. Inline on the settings page (`asTab`), otherwise behind a gear
 * button in a modal.
 */
export default function ViewerMetadataSettings({ asTab = false, withHeader = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState(TAB_VIEWPORT);

  const { activeServer } = useSelector(redux.selectors.activeOhifServer);

  const { data: aggregate, error: aggregateError } = useDisplayAttributes(activeServer);
  const { data: enabledGroups } = useDisplayAttributeGroups(activeServer);
  const { data: catalogue } = useTags({ server: activeServer });

  const showTabs = offersDisplayAttributes(activeServer && activeServer.perms, enabledGroups);

  // One notification per failed load; Standard Fields stay available throughout.
  const reported = useRef(null);
  useEffect(() => {
    if (aggregateError && reported.current !== aggregateError) {
      reported.current = aggregateError;
      uiNotificationService.show({
        title: 'Shared display attributes unavailable',
        message: 'Only the standard fields are offered until the imaging server responds.',
        type: 'warning',
      });
    }
  }, [aggregateError]);

  const options = useMemo(() => mergeOverlayFieldOptions(aggregate ? aggregate.tags : [], catalogue), [aggregate, catalogue]);

  useEffect(() => {
    if (!showTabs && tab !== TAB_VIEWPORT) {
      setTab(TAB_VIEWPORT);
    }
  }, [showTabs]);

  const close = asTab ? undefined : () => setIsOpen(false);

  const renderContent = () => (
    <>
      {withHeader && asTab && (
        <div>
          <div className={styles.header}>
            <h2 className={styles.tabTitle}>Viewer Metadata Settings</h2>
          </div>
          <p className={styles.description}>Customize the metadata displayed in the viewer window.</p>
          <hr className={styles.divider} style={{ marginBottom: '1rem' }} />
        </div>
      )}
      {!asTab && (
        <>
          <p className={styles.subtitle}>Metadata</p>
          <p className={styles.description}>Customize the metadata displayed in the viewer window.</p>
          <hr className={styles.divider} />
        </>
      )}

      {showTabs ? (
        <TabsNG value={tab} onValueChange={setTab} className={styles.tabs}>
          <TabsNG.List>
            <TabsNG.Trigger value={TAB_VIEWPORT}>Viewport Display</TabsNG.Trigger>
            <TabsNG.Trigger value={TAB_ATTRIBUTES}>Display Attributes</TabsNG.Trigger>
          </TabsNG.List>
          <TabsNG.Content value={TAB_VIEWPORT}>
            <ViewportDisplayTab options={options} onClose={close} />
          </TabsNG.Content>
          <TabsNG.Content value={TAB_ATTRIBUTES}>
            <DisplayAttributesTab server={activeServer} />
          </TabsNG.Content>
        </TabsNG>
      ) : (
        <ViewportDisplayTab options={options} onClose={close} />
      )}
    </>
  );

  if (asTab) {
    return renderContent();
  }

  return (
    <>
      <button className={styles.settingsBtn} onClick={() => setIsOpen(true)}>
        <SettingsIcon />
        <p className={styles.settingsText}>Settings</p>
      </button>
      {isOpen && (
        <ModalNG onClose={close} isOpen={isOpen} title="Viewer Settings" classes={{ content: styles.modal }} hideDivider>
          {renderContent()}
        </ModalNG>
      )}
    </>
  );
}

ViewerMetadataSettings.propTypes = {
  asTab: PropTypes.bool,
  withHeader: PropTypes.bool,
};
