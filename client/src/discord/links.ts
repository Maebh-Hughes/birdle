import { describeError } from './errors';
import type { DiscordEnv } from './sdk';

/**
 * Opens an external URL: Discord's openExternalLink inside Discord (it shows its
 * own "leaving Discord" confirmation), a new tab in mock mode.
 * Returns false only when the link could not be opened at all.
 */
export async function openExternal(env: Pick<DiscordEnv, 'embedded' | 'sdk'>, url: string): Promise<boolean> {
  if (!env.embedded) {
    window.open(url, '_blank', 'noopener');
    return true;
  }
  try {
    // opened is false when the player declines and null on clients that don't report it.
    await env.sdk.commands.openExternalLink({ url });
    return true;
  } catch (error) {
    console.warn('BIRDLE: openExternalLink failed:', describeError(error));
    return false;
  }
}
