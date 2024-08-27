import { expect } from 'chai';
import gql from 'graphql-tag';

import { Hermes } from '../../../../src';
import { strictConfig } from '../../../helpers';

describe(`writeFragment when using multiple fragments without fragmentName`, () => {

  let hermes: Hermes;
  beforeAll(() => {
    hermes = new Hermes(strictConfig);
  });

  it(`throws an error`, () => {
    expect(() => {
      hermes.writeFragment({
        id: '123',
        fragment: gql(`
          fragment viewer on Viewer {
            id
            name
          }

          fragment shipment on Shipment {
            id
            name
            startLoc
            stopLoc
          }
        `),
        data: {
          id: 123,
          name: 'Gouda',
          __typename: 'Viewer',
        },
      });
    }).to.throw(/An error occurred! For more details, see the full error text at |Found 2 fragments. `fragmentName` must be provided when there is not exactly 1 fragment./i);
  });

});
