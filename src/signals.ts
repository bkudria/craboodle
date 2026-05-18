export interface SignalHandlerDeps {
  exit?: (code: number) => never;
  log?: (msg: string) => void;
  setTimeout?: typeof globalThis.setTimeout;
}

export interface SignalHandlerOptions extends SignalHandlerDeps {
  controller: AbortController;
  cleanupTimeoutMs?: number;
  onFirstSignal?: () => void;
}

const INTERRUPT_MESSAGE =
  '[craboodle] Interrupted. Cleaning up subprocesses (Ctrl-C again to force-exit)...\n';

export function installSignalHandler(opts: SignalHandlerOptions): () => void {
  const exit = opts.exit ?? (process.exit as (code: number) => never);
  const log = opts.log ?? ((msg: string) => process.stderr.write(msg));
  const schedule = opts.setTimeout ?? globalThis.setTimeout;
  const cleanupTimeoutMs = opts.cleanupTimeoutMs ?? 500;

  let firstFired = false;
  const handler = (): void => {
    if (firstFired) {
      exit(130);
      return;
    }
    firstFired = true;
    log(INTERRUPT_MESSAGE);
    opts.controller.abort();
    opts.onFirstSignal?.();
    const handle = schedule(() => exit(130), cleanupTimeoutMs);
    (handle as { unref?: () => void }).unref?.();
  };

  process.on('SIGINT', handler);
  return () => {
    process.off('SIGINT', handler);
  };
}
