/**
 * High-resolution elapsed-time helper.
 *
 * startTimer captures the current timestamp via performance.now() and returns
 * a thunk that, when called, returns the number of milliseconds elapsed since
 * the capture. Using performance.now() rather than Date.now() avoids wall-clock
 * skew from NTP adjustments during long-running queries.
 */

const startTimer = (): (() => number) => {
  const start = performance.now();
  return (): number => performance.now() - start;
};

export { startTimer };
