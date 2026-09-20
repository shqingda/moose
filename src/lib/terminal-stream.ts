import type { TerminalOutput } from '../../shared/terminal';

/** Serialize replay and live output; slow renderers catch up from the bounded server buffer. */
export function terminalStream(
  read: (offset: number) => Promise<TerminalOutput>,
  write: (output: TerminalOutput) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let offset = 0;
  let busy = false;
  let pending = false;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    if (closed) return;
    if (busy) {
      pending = true;
      return;
    }
    void consume();
  };
  const consume = async (live?: TerminalOutput) => {
    if (closed) return;
    busy = true;
    clearTimeout(retry);
    try {
      let update = live;
      if (!update || update.offset - update.data.length > offset) update = await read(offset);
      else if (update.offset < offset) return;
      else if (!update.reset)
        update = {
          ...update,
          data: update.data.slice(Math.max(0, offset - (update.offset - update.data.length))),
        };
      if (closed) return;
      await write(update);
      offset = update.offset;
    } catch (error) {
      if (!closed) {
        onError(error);
        pending = false;
        retry = setTimeout(sync, 1000);
      }
    } finally {
      busy = false;
      if (pending && !closed) {
        pending = false;
        sync();
      }
    }
  };
  return {
    sync,
    push(update: TerminalOutput) {
      if (closed) return;
      if (busy) {
        pending = true;
        return;
      }
      void consume(update);
    },
    close() {
      closed = true;
      clearTimeout(retry);
    },
  };
}
