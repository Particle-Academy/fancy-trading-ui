/**
 * React needs to be told it is inside a test environment, or `act()` warns on
 * every render and does not actually flush the work it is supposed to flush.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export {};
