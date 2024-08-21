import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { write } from '../../../../../src/operations';
import { RawOperation, StaticNodeId } from '../../../../../src/schema';
import { query, strictConfig } from '../../../../helpers';
import { getOutbound } from '../../../../../src/util';

const { QueryRoot: QueryRootId } = StaticNodeId;

// These are really more like integration tests, given the underlying machinery.
//
// It just isn't very fruitful to unit test the individual steps of the write
// workflow in isolation, given the contextual state that must be passed around.
describe(`operations.write`, () => {

  const context = new CacheContext(strictConfig);
  const empty = new GraphSnapshot();

  describe(`same alias name in different scope`, () => {

    let aliasQuery: RawOperation, snapshot: GraphSnapshot;
    beforeAll(() => {
      aliasQuery = query(`{
        shipment: Shipment {
          id: shipmentId,
          name: shipmentName,
        }
        dispatch: Dispatcher {
          id
          name
        }
        carrier: Carrier {
          id: carrierId
          name: carrierName
        }
      }`);

      snapshot = write(context, empty, aliasQuery, {
        shipment: {
          id: 0,
          name: 'ToSeattle',
        },
        dispatch: {
          id: 2,
          name: 'Bob The dispatcher',
        },
        carrier: {
          id: 1,
          name: 'Bob',
        },
      }).snapshot;
    });

    it(`only writes fields from the schema`, () => {
      jestExpect(snapshot.getNodeData(QueryRootId)).toEqual({
        Shipment: {
          shipmentId: 0,
          shipmentName: 'ToSeattle',
        },
        Dispatcher: {
          id: 2,
          name: 'Bob The dispatcher',
        },
        Carrier: {
          carrierId: 1,
          carrierName: 'Bob',
        },
      });
    });

    it(`checks shape of GraphNodeSnapshot`, () => {
      jestExpect(snapshot.getNodeSnapshot(QueryRootId)).toEqual({
        inbound: undefined,
        outbound: getOutbound([{ id: '0', path: ['Shipment'] }, { id: '2', path: ['Dispatcher'] }, { id: '1', path: ['Carrier'] }]),
        data: {
          Shipment: {
            shipmentId: 0,
            shipmentName: 'ToSeattle',
          },
          Dispatcher: {
            id: 2,
            name: 'Bob The dispatcher',
          },
          Carrier: {
            carrierId: 1,
            carrierName: 'Bob',
          },
        },
      });
    });

  });
});
