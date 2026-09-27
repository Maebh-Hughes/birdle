import type { Server } from 'node:http';
import type { Store } from './store';

/** How often idle keep-alive connections are closed while waiting for in-flight requests. */
const IDLE_SWEEP_MS = 50;

/**
 * Stops accepting connections, lets in-flight requests finish (cutting whatever
 * is still open after `graceMs`), and only then saves the store. Saving last
 * means every change a request made before its answer was sent reaches the disk.
 */
export async function gracefulShutdown(server: Server, store: Pick<Store, 'flush'>, graceMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    // A keep-alive connection that finishes its request becomes idle; close those as they appear.
    const sweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS);
    const force = setTimeout(() => server.closeAllConnections(), graceMs);
    // The callback runs once every connection has ended, or at once (with an
    // error that doesn't matter here) when the server never started listening.
    server.close(() => {
      clearInterval(sweep);
      clearTimeout(force);
      resolve();
    });
    server.closeIdleConnections();
  });
  await store.flush();
}
