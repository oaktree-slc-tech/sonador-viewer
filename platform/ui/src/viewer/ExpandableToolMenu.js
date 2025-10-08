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
  }
  
  toolbarMenuOverlay = () => {
    // Create overlay for toolbar. Provides a redux provider to ensure that custom
    // components are able to render with the main application context.
    const { reduxStore } = this.props;

    return (
      <Tooltip placement="bottom" className="tooltip-toolbar-overlay" id={`${Math.random()}_tooltip-toolbar-overlay}`}>
        {reduxStore ? (
            <Provider store={reduxStore}>{this.getButtons()}</Provider>
          ) : (
            this.getButtons()
        )}        
      </Tooltip>
    );
  }

  getButtons = () => {
    const _parent = this;

    return this.props.buttons.map((button, index) => {
      //  Create nested buttons for the tool menu

      if (_.isFunction(button.CustomComponent)) {
        const CustomComponent = button.CustomComponent;

        const _handleClick = () => {
          return button.onClick();
          console.log('Button clicked: ', button);
        }

        return (
          <CustomComponent
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

  onExpandableToolClick = () => {
    if (this.props.onGroupMenuClick) {
      this.props.onGroupMenuClick();
    }
    this.setState({
      isExpanded: !this.state.isExpanded,
    });
  };

  onOverlayHide = () => {
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
