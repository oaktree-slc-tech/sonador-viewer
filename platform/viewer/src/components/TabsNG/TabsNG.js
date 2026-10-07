import React from 'react';
import classNames from 'classnames';
import PropTypes from 'prop-types';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@ohif/ui-next';

import styles from './TabsNG.module.scss';

/**
 * The viewer's dialog tabs: `@ohif/ui-next` Radix tabs in the Offline Storage dialog's styling
 * (underlined triggers, Primary Blue active underline). Compose as
 * `TabsNG` > `TabsNG.List` > `TabsNG.Trigger`, with `TabsNG.Content` per value.
 */
export default function TabsNG({ className, ...props }) {
  return <Tabs className={classNames(styles.tabs, className)} {...props} />;
}

function List({ className, ...props }) {
  return <TabsList className={classNames(styles.list, className)} {...props} />;
}

function Trigger({ className, ...props }) {
  return <TabsTrigger className={classNames(styles.trigger, className)} {...props} />;
}

function Content({ className, ...props }) {
  return <TabsContent className={classNames(styles.content, className)} {...props} />;
}

TabsNG.List = List;
TabsNG.Trigger = Trigger;
TabsNG.Content = Content;

const classNameProp = { className: PropTypes.string };
TabsNG.propTypes = classNameProp;
List.propTypes = classNameProp;
Trigger.propTypes = classNameProp;
Content.propTypes = classNameProp;

export { List as TabsNGList, Trigger as TabsNGTrigger, Content as TabsNGContent };
