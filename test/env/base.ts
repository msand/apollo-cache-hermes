import { config } from 'chai';

// Chai

// We are transitioning to using Jasmine for our test expects.  During the
// transition, Jasmine and chai will be run in parallel using jestExpect for
// Jasmine, and the default expect for chai.  Once complete, Jasmine will
// replace the chai global.expect.
// @ts-ignore
global.jestExpect = global.expect;

// Give us all the info!
config.truncateThreshold = 0;
