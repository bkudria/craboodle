import { describe, it, expect, vi, afterEach } from 'vitest';
import { installSignalHandler } from '../src/signals.js';

interface FakeTimeoutHandle {
  unref: () => void;
}

function fakeSetTimeoutFactory(): {
  fn: (cb: () => void, ms: number) => FakeTimeoutHandle;
  calls: Array<{ cb: () => void; ms: number }>;
} {
  const calls: Array<{ cb: () => void; ms: number }> = [];
  return {
    fn: (cb, ms) => {
      calls.push({ cb, ms });
      return { unref: () => {} };
    },
    calls,
  };
}

describe('installSignalHandler', () => {
  afterEach(() => {
    process.removeAllListeners('SIGINT');
  });

  it('aborts controller, writes message, and schedules exit on first SIGINT', () => {
    const controller = new AbortController();
    const log = vi.fn();
    const exit = vi.fn();
    const { fn: fakeSetTimeout, calls } = fakeSetTimeoutFactory();

    const uninstall = installSignalHandler({
      controller,
      log,
      exit: exit as unknown as (code: number) => never,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
    });

    process.emit('SIGINT');

    expect(controller.signal.aborted).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('Cleaning up subprocesses');
    expect(log.mock.calls[0][0]).toContain('Ctrl-C again');
    expect(calls).toHaveLength(1);
    expect(calls[0].ms).toBe(500);
    expect(exit).not.toHaveBeenCalled();

    uninstall();
  });

  it('exits 130 immediately on second SIGINT', () => {
    const controller = new AbortController();
    const exit = vi.fn();
    const { fn: fakeSetTimeout } = fakeSetTimeoutFactory();

    const uninstall = installSignalHandler({
      controller,
      log: vi.fn(),
      exit: exit as unknown as (code: number) => never,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
    });

    process.emit('SIGINT');
    process.emit('SIGINT');

    expect(exit).toHaveBeenCalledWith(130);

    uninstall();
  });

  it('uninstall detaches the listener', () => {
    const controller = new AbortController();
    const log = vi.fn();
    const exit = vi.fn();
    const { fn: fakeSetTimeout } = fakeSetTimeoutFactory();

    const uninstall = installSignalHandler({
      controller,
      log,
      exit: exit as unknown as (code: number) => never,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
    });

    uninstall();
    process.emit('SIGINT');

    expect(log).not.toHaveBeenCalled();
    expect(controller.signal.aborted).toBe(false);
  });

  it('invokes onFirstSignal on first SIGINT', () => {
    const controller = new AbortController();
    const onFirstSignal = vi.fn();
    const { fn: fakeSetTimeout } = fakeSetTimeoutFactory();

    const uninstall = installSignalHandler({
      controller,
      onFirstSignal,
      log: vi.fn(),
      exit: vi.fn() as unknown as (code: number) => never,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
    });

    process.emit('SIGINT');
    expect(onFirstSignal).toHaveBeenCalledTimes(1);

    uninstall();
  });

  it('scheduled exit fires when timer callback runs', () => {
    const controller = new AbortController();
    const exit = vi.fn();
    const { fn: fakeSetTimeout, calls } = fakeSetTimeoutFactory();

    const uninstall = installSignalHandler({
      controller,
      log: vi.fn(),
      exit: exit as unknown as (code: number) => never,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
    });

    process.emit('SIGINT');
    calls[0].cb();

    expect(exit).toHaveBeenCalledWith(130);
    uninstall();
  });

  it('honours custom cleanupTimeoutMs', () => {
    const controller = new AbortController();
    const { fn: fakeSetTimeout, calls } = fakeSetTimeoutFactory();

    const uninstall = installSignalHandler({
      controller,
      log: vi.fn(),
      exit: vi.fn() as unknown as (code: number) => never,
      setTimeout: fakeSetTimeout as unknown as typeof globalThis.setTimeout,
      cleanupTimeoutMs: 1234,
    });

    process.emit('SIGINT');
    expect(calls[0].ms).toBe(1234);

    uninstall();
  });

  it('uses default exit, log, setTimeout when not provided', () => {
    const controller = new AbortController();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      _cb: () => void,
      _ms?: number,
    ) => {
      return { unref: () => {} } as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const uninstall = installSignalHandler({ controller });

    process.emit('SIGINT');

    expect(stderrSpy).toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalled();

    uninstall();
    stderrSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });
});
