import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import chaiJestDiff from 'chai-jest-diff';

// Chai

// We are transitioning to using Jasmine for our test expects.  During the
// transition, Jasmine and chai will be run in parallel using jestExpect for
// Jasmine, and the default expect for chai.  Once complete, Jasmine will
// replace the chai global.expect.
// @ts-ignore
global.jestExpect = global.expect;

// Give us all the info!
chai.config.truncateThreshold = 0;

// Pretty expectation output for Chai assertions
chai.use(chaiJestDiff());

// Promise-aware chai assertions (that return promises themselves):
//
//   await expect(promise).to.be.rejectedWith(/error/i);
//
chai.use(chaiAsPromised);
