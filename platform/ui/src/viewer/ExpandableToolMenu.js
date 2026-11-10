import _ from 'lodash';

import React from 'react';
import { Provider, ReactReduxContext } from 'react-redux';
import PropTypes from 'prop-types';

import { OverlayTrigger } from '../components/overlayTrigger';
import { Tooltip } from '../components/tooltip';

import ToolbarButton from './ToolbarButton.js';

import './ExpandableToolMenu.styl';


class ExpandableToolMenu extends React.Component {

  static propTypes = {
    /** Button label */
    label: PropTypes.string.isRequired,
    /** Array of buttons to render when expanded */
    buttons: PropTypes.arrayOf(
      PropTypes.shape({
        id: PropTypes.string,
        label: PropTypes.string.isRequired,
        icon: PropTypes.oneOfType([
          PropTypes.string,
          PropTypes.shape({
            name: PropTypes.string.isRequired,
          }),
        ]),
      })
    ).isRequired,
    icon: PropTypes.oneOfType([
      PropTypes.string,
      PropTypes.shape({
        name: PropTypes.string.isRequired,
      }),
    ]),
    onGroupMenuClick: PropTypes.func,
    activeCommand: PropTypes.string,
    /** Toolbar click handler, called as (button, evt); lets CustomComponents override the dispatched command */
    toolbarClickCallback: PropTypes.func,
  };

  static defaultProps = {
    buttons: [],
    icon: 'ellipse-circle',
    label: 'More',
  };

  constructor(props) {
    super(props);
    this.state = {
      isExpanded: false,
    };

    // The menu is portaled to the end of the document: a keyboard user is moved into it when it
    // opens and back to its trigger when it closes from inside
    this.menuId = _.uniqueId('expandable-tool-menu-');
    this.triggerId = `${this.menuId}-trigger`;
    this.openedByKeyboard = false;
  }

  componentDidUpdate(prevProps, prevState) {
    if (!prevState.isExpanded && this.state.isExpanded && this.openedByKeyboard) {
      // The overlay mounts after this render
      setTimeout(() => {
        const first = document.getElementById(this.menuId)?.querySelector('[tabindex="0"]');
        if (first) {
          first.focus();
        }
      }, 0);
    }
  }

  
  toolbarMenuOverlay = () => {
    // Create overlay for toolbar. Provides a redux provider to ensure that custom
    // components are able to render with the main application context.
    const { reduxStore } = this.props;

    return (
      <Tooltip placement="bottom" className="tooltip-toolbar-overlay" id={`${Math.random()}_tooltip-toolbar-overlay}`}>
        <div id={this.menuId} role="group" aria-label={this.props.label}>
          {reduxStore ? (
              <Provider store={reduxStore}>{this.getButtons()}</Provider>
            ) : (
              this.getButtons()
          )}
        </div>
      </Tooltip>
    );
  }

  getButtons = () => {
    const _parent = this;

    return this.props.buttons.map((button, index) => {
      //  Create nested buttons for the tool menu

      if (_.isFunction(button.CustomComponent)) {
        const CustomComponent = button.CustomComponent;

        // button.onClick is pre-bound to the static button definition, so it discards any
        // command override the CustomComponent passes (e.g. LocalCacheToolbarButton switching
        // between goOffline/removeOffline). Forward the component's button when possible.
        const _handleClick = (overriddenButton, evt) => {
          if (_.isFunction(this.props.toolbarClickCallback)) {
            return this.props.toolbarClickCallback(overriddenButton || button, evt);
          }

          return button.onClick();
        }

        return (
          <CustomComponent
            key={button.id || index}
            parentContext={_parent}
            toolbarClickCallback={_handleClick}
            button={button}
            activeButtons={[]}
            isActive={button.id === this.props.activeCommand}
          />
        );
      }

      return <ToolbarButton key={index} {...button} isActive={button.id === this.props.activeCommand} />;
    });
  };

  isActive = () => {
    let isActive = false;
    if (this.props.activeCommand) {
      this.props.buttons.forEach((button) => {
        if (this.props.activeCommand === button.id) {
          isActive = true;
        }
      });
    }

    return isActive;
  };

  activeIcon = () => {
    if (this.props.activeCommand) {
      return this.props.buttons.find((btn) => this.props.activeCommand === btn.id).icon || this.props.icon;
    }

    return this.props.icon;
  };

  onExpandableToolClick = (event) => {
    // ToolbarButton passes the activating event: keydown for Enter, keyup for Space
    this.openedByKeyboard = !!event && (event.type === 'keydown' || event.type === 'keyup');
    if (this.props.onGroupMenuClick) {
      this.props.onGroupMenuClick();
    }
    this.setState({
      isExpanded: !this.state.isExpanded,
    });
  };

  onOverlayHide = () => {
    // Closed from inside the menu (Escape): focus returns to the trigger
    const menu = document.getElementById(this.menuId);
    if (menu && menu.contains(document.activeElement)) {
      document.getElementById(this.triggerId)?.focus();
    }
    this.setState({
      isExpanded: false,
    });
  };

  render() {
    return (
      <OverlayTrigger
        key="menu-button"
        trigger="click"
        placement="bottom"
        rootClose={true}
        handleHide={this.onOverlayHide}
        onClick={this.onExpandableToolClick}
        overlay={this.toolbarMenuOverlay()}
      >
        <ToolbarButton
          key="menu-button"
          type="tool"
          domId={this.triggerId}
          label={this.props.label}
          icon={this.activeIcon()}
          className={'toolbar-button expandableToolMenu'}
          isActive={this.isActive()}
          isExpandable={true}
          isExpanded={this.state.isExpanded}
        />
      </OverlayTrigger>
    );
  }
}


export default ExpandableToolMenu;
