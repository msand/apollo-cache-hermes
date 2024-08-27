import { spyOnConsole } from "../index";

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalDebug = console.debug;
const originalInfo = console.info;

/*
 * Ugly workaround until https://github.com/jestjs/jest/issues/14874 is fixed
 */
const disposeSymbol: unique symbol = Symbol("Symbol.dispose");
const asyncDisposeSymbol: unique symbol = Symbol("Symbol.asyncDispose");
type Writable<T> = {
  -readonly [TKey in keyof T]: T[TKey];
};
(Symbol as Writable<SymbolConstructor>).asyncDispose ??=
  asyncDisposeSymbol as unknown as SymbolConstructor["asyncDispose"];
(Symbol as Writable<SymbolConstructor>).dispose ??=
  disposeSymbol as unknown as SymbolConstructor["dispose"];

describe("spyOnConsole", () => {
  it("intercepts calls to `console.log` and `console.info`", () => {
    using consoleSpies = spyOnConsole("log", "info");
    console.log("hello");
    console.info("world");
    expect(consoleSpies.log).toHaveBeenCalledWith("hello");
    expect(consoleSpies.info).toHaveBeenCalledWith("world");
  });

  it("restores the original `console` methods", () => {
    {
      using _consoleSpies = spyOnConsole(
        "log",
        "info",
        "warn",
        "error",
        "debug"
      );
      expect(console.log).not.toBe(originalLog);
      expect(console.warn).not.toBe(originalWarn);
      expect(console.error).not.toBe(originalError);
      expect(console.debug).not.toBe(originalDebug);
      expect(console.info).not.toBe(originalInfo);
    }
    expect(console.log).toBe(originalLog);
    expect(console.warn).toBe(originalWarn);
    expect(console.error).toBe(originalError);
    expect(console.debug).toBe(originalDebug);
    expect(console.info).toBe(originalInfo);
  });

  it("only mocks requested methods", () => {
    {
      using consoleSpies = spyOnConsole("log", "warn");
      expect(consoleSpies.log).toBeDefined();
      expect(consoleSpies.warn).toBeDefined();
      // @ts-expect-error
      expect(consoleSpies.error).not.toBeDefined();
      // @ts-expect-error
      expect(consoleSpies.debug).not.toBeDefined();
      // @ts-expect-error
      expect(consoleSpies.info).not.toBeDefined();
      expect(console.log).not.toBe(originalLog);
      expect(console.warn).not.toBe(originalWarn);
      expect(console.error).toBe(originalError);
      expect(console.debug).toBe(originalDebug);
      expect(console.info).toBe(originalInfo);
    }
    expect(console.log).toBe(originalLog);
    expect(console.warn).toBe(originalWarn);
    expect(console.error).toBe(originalError);
    expect(console.debug).toBe(originalDebug);
    expect(console.info).toBe(originalInfo);
  });
});
