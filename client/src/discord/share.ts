import { describeError } from './errors';
import type { DiscordEnv } from './sdk';

/**
 * - shared / link-copied / dismissed: Discord's share modal (shareLink) handled it
 * - copied: the text is on the clipboard
 * - manual: nothing worked; show the text for the player to copy by hand
 */
export type ShareOutcome = 'shared' | 'link-copied' | 'dismissed' | 'copied' | 'manual';

/**
 * Inside Discord: shareLink (posts the message plus a Play link where the player
 * chooses). If that throws (e.g. 4002 on old clients), or in mock mode:
 * clipboard API -> execCommand('copy') -> manual copy.
 */
export async function shareResult(
  env: Pick<DiscordEnv, 'embedded' | 'sdk'>,
  text: string,
  customId: string,
): Promise<ShareOutcome> {
  if (env.embedded) {
    try {
      const result = await env.sdk.commands.shareLink({ message: text, custom_id: customId });
      if (result.didSendMessage) return 'shared';
      if (result.didCopyLink) return 'link-copied';
      return result.success ? 'shared' : 'dismissed';
    } catch (error) {
      console.warn('BIRDLE: shareLink failed, falling back to the clipboard:', describeError(error));
    }
  }
  return (await copyText(text)) ? 'copied' : 'manual';
}

/** Copies text with the async clipboard API, falling back to execCommand('copy'). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Blocked by the iframe's permissions policy or not focused: try the legacy path.
  }
  return execCommandCopy(text);
}

function execCommandCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  Object.assign(textarea.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    previousFocus?.focus();
  }
}
