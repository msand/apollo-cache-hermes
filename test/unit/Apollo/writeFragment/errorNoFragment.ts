import { expect } from 'chai';
import gql from 'graphql-tag';

import { Hermes } from '../../../../src';
import { strictConfig } from '../../../helpers';

describe(`writeFragment with no fragment`, () => {

  let hermes: Hermes;
  beforeAll(() => {
    hermes = new Hermes(strictConfig);
  });

  it(`throws an error`, () => {
    expect(() => {
      hermes.writeFragment({
        id: '123',
        fragment: gql(`
          query viewer {
            id
            name
          }
        `),
        data: {
          id: 123,
          name: 'Gouda',
          __typename: 'Viewer',
        },
      });
    }).to.throw(/An error occurred! For more details, see the full error text at |Found a query operation named 'viewer'. No operations are allowed when using a fragment as a query. Only fragments are allowed./i);
  });

});
