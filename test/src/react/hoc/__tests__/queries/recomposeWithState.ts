// Adapted from v0.30.0 of https://github.com/acdlite/recompose/blob/master/src/packages/recompose/withState.js
// to avoid incurring an indirect dependency on ua-parser-js via fbjs.

import React, { createFactory, Component } from 'react';

const setStatic
  = (key: string, value: string) => <T>(BaseComponent: React.ComponentClass<T>) => {
    BaseComponent[key] = value;
    return BaseComponent;
  };

const setDisplayName = (displayName: string) =>
  setStatic('displayName', displayName);

const getDisplayName = <T>(Component: React.ComponentClass<T>) => {
  if (typeof Component === 'string') {
    return Component;
  }

  if (!Component) {
    return undefined;
  }

  return Component.displayName || Component.name || 'Component';
};

const wrapDisplayName = <T>(
  BaseComponent: React.ComponentClass<T>,
  hocName: string
) => `${hocName}(${getDisplayName(BaseComponent)})`;

export const withState
  = <T extends {[k in SN]: Initial} & {[k in SUN]: (val: Initial) => Initial}, SN extends string, SUN extends string, Initial>(stateName: SN, stateUpdaterName: SUN, initialState: Initial) =>
    (BaseComponent: React.ComponentClass<T>) => {
      const factory = createFactory(BaseComponent);
      class WithState extends Component<
      Record<string, unknown>,
      { stateValue: unknown }
    > {
        state = {
          stateValue:
          typeof initialState === 'function'
            ? initialState(this.props)
            : initialState,
        };

        updateStateValue = (
          updateFn: (stateValue: unknown) => void,
          callback: () => void
        ) =>
          this.setState(
            ({ stateValue }) => ({
              stateValue:
              typeof updateFn === 'function' ? updateFn(stateValue) : updateFn,
            }),
            callback
          );

        render() {
          return factory({
            ...this.props,
            [stateName]: this.state.stateValue,
            [stateUpdaterName]: this.updateStateValue,
          } as T);
        }
      }

      if (__DEV__) {
        return setDisplayName(wrapDisplayName(BaseComponent, 'withState'))(
          WithState
        );
      }

      return WithState;
    };

// Jest complains if modules within __tests__ directories contain no tests.
describe('withState', () => {
  it('is a function', () => {
    expect(typeof withState).toBe('function');
  });
});
