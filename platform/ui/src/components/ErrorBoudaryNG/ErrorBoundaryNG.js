import React, { Component } from 'react';
import PropTypes from 'prop-types';

export default class ErrorBoundaryNG extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: '' };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error: JSON.stringify(error) };
  }

  componentDidCatch(error, errorInfo) {
    console.error(error, `${this.props.context} Error in ErrorBoundaryNG`);
    this.props.onError(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent();
      }

      return <div style={{ color: '#fff' }}>Error: {this.state.error || 'Something went wrong'}</div>;
    }

    return this.props.children;
  }
}

ErrorBoundaryNG.propTypes = {
  children: PropTypes.oneOfType([PropTypes.arrayOf(PropTypes.node), PropTypes.node]).isRequired,
  fallbackComponent: PropTypes.func,
  context: PropTypes.string,
  onError: PropTypes.func,
};

ErrorBoundaryNG.defaultProps = {
  context: 'OHIF',
  onError: () => {},
};
