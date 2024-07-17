import type * as ReactTypes from 'react';
// eslint-disable-next-line import/no-extraneous-dependencies
import { renderToString } from 'react-dom/server';

import { getMarkupFromTree } from './getDataFromTree';

export function renderToStringWithData(
  component: ReactTypes.ReactElement<any>
): Promise<string> {
  return getMarkupFromTree({
    tree: component,
    renderFunction: renderToString,
  });
}
