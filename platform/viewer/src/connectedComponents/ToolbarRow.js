// Toolbar row component for editor. Manages which tools are visible based on active context
// and viewport.

import React, { Component } from 'react';
import { withTranslation } from 'react-i18next';
import _ from 'lodash';
import PropTypes from 'prop-types';

import { MODULE_TYPES } from '@ohif/core';
import { ExpandableToolMenu, RoundedButtonGroup, ToolbarButton, withDialog, withModal } from '@ohif/ui';
import { useLayoutButton } from '@ohif/ui/src/store/useLayoutButton';

import { commandsManager, extensionManager } from '../App';
import { withAppContext } from '../context/AppContext';
import { useViewerSidePanels } from '../store/useViewerSidePanels';

import ConnectedCineDialog from './ConnectedCineDialog';
import ConnectedLayoutButton from './ConnectedLayoutButton';

import styles from './ToolbarRow.module.scss';

class ToolbarRow extends Component {
  // TODO: Simplify these? isOpen can be computed if we say "any" value for selected,
  // closed if selected is null/undefined
  static propTypes = {
    activeContexts: PropTypes.arrayOf(PropTypes.string).isRequired,
    studies: PropTypes.array,
    t: PropTypes.func.isRequired,
    // NOTE: withDialog, withModal HOCs
    dialog: PropTypes.any,
    modal: PropTypes.any,
  };

  static defaultProps = {
    studies: [],
  };

  constructor(props) {
    super(props);

    const toolbarButtonDefinitions = getVisibleToolbarButtons.call(this);
    // TODO:
    // If it's a tool that can be active... Mark it as active?
    // - Tools that are on/off?
    // - Tools that can be bound to multiple buttons?

    // Normal ToolbarButtons...
    // Just how high do we need to hoist this state?
    // Why ToolbarRow instead of just Toolbar? Do we have any others?
    this.state = {
      toolbarButtons: toolbarButtonDefinitions,
      activeButtons: [],
    };

    this.seriesPerStudyCount = [];

    this.handleBuiltIn = handleBuiltIn.bind(this);
    this.onDerivedDisplaySetsLoadedAndCached = this.onDerivedDisplaySetsLoadedAndCached.bind(this);

    this.updateButtonGroups();
  }

  updateButtonGroups() {
    const panelModules = extensionManager.modules[MODULE_TYPES.PANEL];

    this.buttonGroups = {
      left: [],
      right: [],
    };

    // ~ FIND MENU OPTIONS
    panelModules.forEach((panelExtension) => {
      const panelModule = panelExtension.module;
      const defaultContexts = Array.from(panelModule.defaultContext);

      panelModule.menuOptions.forEach((menuOption) => {
        const contexts = Array.from(menuOption.context || defaultContexts);
        const hasActiveContext = this.props.activeContexts.some((actx) => contexts.includes(actx));

        // It's a bit beefy to pass studies; probably only need to be reactive on `studyInstanceUIDs` and activeViewport?
        // Note: This does not cleanly handle `studies` prop updating with panel open
        const isDisabled =
          typeof menuOption.isDisabled === 'function' &&
          menuOption.isDisabled(this.props.studies, this.props.activeViewport);

        if (hasActiveContext && !isDisabled) {
          const menuOptionEntry = {
            value: menuOption.target,
            icon: menuOption.icon,
            bottomLabel: menuOption.label,
            badgeNumber: menuOption.badgeNumber,
            stateEvent: menuOption.stateEvent,
          };
          const from = menuOption.from || 'right';

          this.buttonGroups[from].push(menuOptionEntry);
        }
      });
    });

    // TODO: This should come from extensions, instead of being baked in
    this.buttonGroups.left.unshift({
      value: 'studies',
      icon: 'th-large',
      bottomLabel: this.props.t('Series'),
    });
  }

  componentDidMount() {
    /*
     * TODO: Improve the way we notify parts of the app
     * that depends on derived display sets to be loaded.
     * (Implement pubsub for better tracking of derived display sets)
     */
    document.addEventListener('deriveddisplaysetsloadedandcached', this.onDerivedDisplaySetsLoadedAndCached);
  }

  componentWillUnmount() {
    document.removeEventListener('deriveddisplaysetsloadedandcached', this.onDerivedDisplaySetsLoadedAndCached);
  }

  onDerivedDisplaySetsLoadedAndCached() {
    this.updateButtonGroups();
    this.setState({
      toolbarButtons: getVisibleToolbarButtons.call(this),
    });
  }

  componentDidUpdate(prevProps) {
    const activeContextsChanged = prevProps.activeContexts !== this.props.activeContexts;

    this.updateButtonGroups();

    if (activeContextsChanged) {
      this.setState(
        {
          toolbarButtons: getVisibleToolbarButtons.call(this),
        },
        this.closeCineDialogIfNotApplicable
      );
    }
  }

  closeCineDialogIfNotApplicable = () => {
    const { dialog } = this.props;
    let { dialogId, activeButtons, toolbarButtons } = this.state;
    if (dialogId) {
      const cineButtonPresent = toolbarButtons.find((button) => button.options && button.options.behavior === 'CINE');
      if (!cineButtonPresent) {
        dialog.dismiss({ id: dialogId });
        activeButtons = activeButtons.filter((button) => button.options && button.options.behavior !== 'CINE');
        this.setState({ dialogId: null, activeButtons });
      }
    }
  };

  render() {
    const buttonComponents = getButtonComponents.call(this, this.state.toolbarButtons, this.state.activeButtons);
    const { isDisplayedLayoutButton } = useLayoutButton.getState();
    const {
      setIsIssuesContentRightSidePanel,
      selectedRightSidePanel,
      isRightSidePanelOpen,
      isLeftSidePanelOpen,
      selectedLeftSidePanel,
      onChangeSidePanel,
    } = useViewerSidePanels.getState();

    const onPressLeft = onChangeSidePanel.bind(this, 'left');
    const onPressRight = onChangeSidePanel.bind(this, 'right');

    return (
      <div className={styles.toolbarRow}>
        <div className={styles.left}>
          <div className={styles.leftRoundedContainer}>
            <RoundedButtonGroup
              options={this.buttonGroups.left}
              value={isLeftSidePanelOpen ? selectedLeftSidePanel : ''}
              onValueChanged={onPressLeft}
            />
          </div>
          {buttonComponents}
          {isDisplayedLayoutButton && <ConnectedLayoutButton />}
        </div>
        <div className={styles.right}>
          {this.buttonGroups.right.length && (
            <RoundedButtonGroup
              options={this.buttonGroups.right}
              value={isRightSidePanelOpen ? selectedRightSidePanel : ''}
              onValueChanged={(values) => {
                onPressRight(values);
                setIsIssuesContentRightSidePanel(false);
              }}
            />
          )}
        </div>
      </div>
    );
  }
}

/**
 * Determine which extension buttons should be showing, if they're
 * active, and what their onClick behavior should be.
 */
function getButtonComponents(toolbarButtons, activeButtons) {
  return toolbarButtons.map((button) => {
    const hasCustomComponent = button.CustomComponent;
    const hasNestedButtonDefinitions = button.buttons && button.buttons.length;

    if (hasCustomComponent) {
      const CustomComponent = button.CustomComponent;
      const isValidComponent = typeof CustomComponent === 'function';

      // Check if its a valid customComponent. Later on an CustomToolbarComponent interface could be implemented.
      if (isValidComponent) {
        const parentContext = this;
        const activeButtonsIds = activeButtons.map((button) => button.id);
        const isActive = activeButtonsIds.includes(button.id);

        return (
          <CustomComponent
            parentContext={parentContext}
            toolbarClickCallback={handleToolbarButtonClick.bind(this)}
            button={button}
            key={button.id}
            activeButtons={activeButtonsIds}
            isActive={isActive}
          />
        );
      }
    }

    if (hasNestedButtonDefinitions) {
      // Iterate over button definitions and update `onClick` behavior
      let activeCommand;
      const childButtons = button.buttons.map((childButton) => {
        childButton.onClick = handleToolbarButtonClick.bind(this, childButton);

        if (activeButtons.map((button) => button.id).indexOf(childButton.id) > -1) {
          activeCommand = childButton.id;
        }

        return childButton;
      });

      return (
        <ExpandableToolMenu
          key={button.id}
          label={button.label}
          icon={button.icon}
          buttons={childButtons}
          activeCommand={activeCommand}
        />
      );
    }

    return (
      <ToolbarButton
        key={button.id}
        id={button.id}
        label={button.label}
        icon={button.icon}
        onClick={handleToolbarButtonClick.bind(this, button)}
        isActive={activeButtons.map((button) => button.id).includes(button.id)}
      />
    );
  });
}

/**
 * TODO: DEPRECATE
 * This is used exclusively in `extensions/cornerstone/src`
 * We have better ways with new UI Services to trigger "builtin" behaviors
 *
 * A handy way for us to handle different button types. IE. firing commands for
 * buttons, or initiation built in behavior.
 *
 * @param {*} button
 * @param {*} evt
 */
function handleToolbarButtonClick(button, evt) {
  // Handle a toolbar click event

  const { activeButtons } = this.state;
  const { setIsDisplayedLayoutButton } = useLayoutButton.getState();

  const uiOptions = button.uiOptions || {};

  // Toggle layout button on/off based on the provided UI options of the button
  if (uiOptions && _.isBoolean(uiOptions.layoutButtonVisible)) {
    setIsDisplayedLayoutButton(uiOptions.layoutButtonVisible);
  }

  if (button.commandName) {
    const options = Object.assign({ evt }, button.commandOptions);
    commandsManager.runCommand(button.commandName, options);
  }

  // TODO: Use Types ENUM
  // TODO: We can update this to be a `getter` on the extension to query
  //       For the active tools after we apply our updates?
  if (button.type === 'setToolActive') {
    const toggables = activeButtons.filter(({ options }) => options && !options.togglable);
    this.setState({ activeButtons: [...toggables, button] });
  } else if (button.type === 'builtIn') {
    this.handleBuiltIn(button);
  }
}

/**
 *
 */
function getVisibleToolbarButtons() {
  const toolbarModules = extensionManager.modules[MODULE_TYPES.TOOLBAR];
  const toolbarButtonDefinitions = [];

  toolbarModules.forEach((extension) => {
    const { definitions, defaultContext } = extension.module;
    definitions.forEach((definition) => {
      const context = definition.context || defaultContext;

      if (this.props.activeContexts.includes(context)) {
        toolbarButtonDefinitions.push(definition);
      }
    });
  });

  return toolbarButtonDefinitions;
}

function handleBuiltIn(button) {
  /* TODO: Keep cine button active until its unselected. */
  const { dialog, t } = this.props;
  const { dialogId } = this.state;
  const { id, options } = button;

  if (options.behavior === 'CINE') {
    if (dialogId) {
      dialog.dismiss({ id: dialogId });
      this.setState((state) => ({
        dialogId: null,
        activeButtons: [...state.activeButtons.filter((button) => button.id !== id)],
      }));
    } else {
      const spacing = 20;
      const { x, y } = document.querySelector(`.ViewerMain`).getBoundingClientRect();
      const newDialogId = dialog.create({
        content: ConnectedCineDialog,
        defaultPosition: {
          x: x + spacing || 0,
          y: y + spacing || 0,
        },
      });
      this.setState((state) => ({
        dialogId: newDialogId,
        activeButtons: [...state.activeButtons, button],
      }));
    }
  }

  if (options.behavior === 'DOWNLOAD_SCREEN_SHOT') {
    commandsManager.runCommand('showDownloadViewportModal', {
      title: t('Download High Quality Image'),
    });
  }
}

export default withTranslation(['Common', 'ViewportDownloadForm'])(withModal(withDialog(withAppContext(ToolbarRow))));
