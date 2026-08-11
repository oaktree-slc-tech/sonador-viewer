import React from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

import { parseUserAgent } from '../../../utils/userAgentParser';

import './AboutContent.styl';

const REPOSITORY_URL = 'https://code.oak-tree.tech/oak-tree/medical-imaging/ohif-viewers';
const COMMITS_URL = `${REPOSITORY_URL}/-/commits/master`;

const capitalize = (s) => s.substr(0, 1).toUpperCase() + s.substr(1).toLowerCase();

const AboutContent = ({ items = [] }) => {
  // Displays source versions for the Sonador web application, Orthanc, the Orthanc cloud plugin,
  // and the Sonador Viewer, plus the browser and OS. Rows describing anything beyond this viewer
  // are supplied by the caller through `items`; see the viewer's `AboutSonador`.

  const { t } = useTranslation('AboutContent');

  const { osName, browserName, browserVersion, osVersion } = parseUserAgent();

  const itemsPreset = () => {
    return [
      { section: t('This Device') },
      {
        name: t('Browser'),
        value: `${capitalize(browserName)} ${browserVersion}`,
      },
      {
        name: t('Operating System'),
        value: `${osName} ${osVersion}`,
      },

      // The separately released Sonador components. Only the viewer's own version is known here.
      { section: t('Sonador Platform') },
      {
        name: t('Sonador Viewer'),
        value: process.env.VERSION_NUMBER,
      },
      ...items,

      { section: t('Source Code') },
      {
        name: t('Repository'),
        value: REPOSITORY_URL,
        link: REPOSITORY_URL,
      },
      {
        name: t('Latest Master Commits'),
        value: COMMITS_URL,
        link: COMMITS_URL,
      },
    ];
  };

  const renderSectionRow = ({ section }) => (
    <tr key={`section:${section}`} className="sectionRow">
      <th colSpan={2} scope="colgroup">
        {section}
      </th>
    </tr>
  );

  // An array value is several independently versioned components sharing a row, laid out with space
  // between them rather than run together behind a separator.
  const renderValue = (value) =>
    Array.isArray(value) ? (
      <span className="segments">
        {value.map((segment, index) => (
          <span className="segment" key={index}>
            {segment}
          </span>
        ))}
      </span>
    ) : (
      value
    );

  const renderTableRow = ({ name, value, link, detail, detailLink }) => (
    <tr key={name}>
      <th scope="row">{name}</th>
      <td>
        {link ? (
          <a target="_blank" rel="noopener noreferrer" href={link}>
            {value}
          </a>
        ) : (
          renderValue(value)
        )}
        {detail ? (
          <div className="detail">
            {detailLink ? (
              <a target="_blank" rel="noopener noreferrer" href={detailLink}>
                {detail}
              </a>
            ) : (
              detail
            )}
          </div>
        ) : null}
      </td>
    </tr>
  );

  return (
    <div className="AboutContent" data-cy="about-modal">
      <div className="btn-group">
        <a
          className="btn btn-default"
          target="_blank"
          rel="noopener noreferrer"
          href={`${REPOSITORY_URL}/-/issues/new`}
        >
          {t('Report an issue')}
        </a>
        {` `}
        <a className="btn btn-default" target="_blank" rel="noopener noreferrer" href="https://sonador.oak-tree.tech">
          {t('More details')}
        </a>
      </div>
      <div>
        <h3>{t('Version Information')}</h3>
        <table className="table table-responsive">
          <tbody>
            {itemsPreset().map((item) => (item.section ? renderSectionRow(item) : renderTableRow(item)))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

AboutContent.propTypes = {
  /**
   * Additional rows describing the platform this viewer is connected to, rendered inside the
   * "Sonador Platform" group directly after the viewer's own version, in the order given.
   *
   * Each entry is `{ name, value, link, detail, detailLink }`. Only `name` is required. `link`
   * renders the value as an external anchor. `detail` renders a secondary line beneath the value
   * -- used for the service URL that belongs to the version above it, so that a component and its
   * address stay one row rather than two -- and `detailLink` makes that line an anchor.
   *
   * A `value` given as an array is rendered as separately spaced segments, for a row covering more
   * than one independently versioned component.
   */
  items: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string,
      value: PropTypes.node,
      link: PropTypes.string,
      detail: PropTypes.node,
      detailLink: PropTypes.string,
    })
  ),
};

export { AboutContent };
export default AboutContent;
