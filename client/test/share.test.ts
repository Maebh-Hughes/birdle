import type { IDiscordSDK } from '@discord/embedded-app-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText, shareResult } from '../src/discord/share';

type ShareLink = IDiscordSDK['commands']['shareLink'];

function env(embedded: boolean, shareLink?: ShareLink) {
  const sdk = { commands: { shareLink: shareLink ?? vi.fn() } } as unknown as IDiscordSDK;
  return { embedded, sdk };
}

function mockClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText: vi.fn(writeText) } : undefined,
  });
}

function mockExecCommand(impl: () => boolean) {
  const execCommand = vi.fn(impl);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
  return execCommand;
}

const TEXT = 'BIRDLE #7 3/6\n⬛🟨⬛⬛⬛\n🟩🟩⬛🟩⬛\n🟩🟩🟩🟩🟩';

describe('shareResult', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('uses Discord shareLink inside Discord', async () => {
    const shareLink = vi.fn(async () => ({ success: true, didSendMessage: true, didCopyLink: false }));
    const outcome = await shareResult(env(true, shareLink), TEXT, 'birdle-7');
    expect(outcome).toBe('shared');
    expect(shareLink).toHaveBeenCalledWith({ message: TEXT, custom_id: 'birdle-7' });
  });

  it('reports a copied link and a dismissed modal', async () => {
    const copied = vi.fn(async () => ({ success: true, didSendMessage: false, didCopyLink: true }));
    expect(await shareResult(env(true, copied), TEXT, 'birdle-7')).toBe('link-copied');
    const dismissed = vi.fn(async () => ({ success: false, didSendMessage: false, didCopyLink: false }));
    expect(await shareResult(env(true, dismissed), TEXT, 'birdle-7')).toBe('dismissed');
  });

  it('falls back to the clipboard when shareLink rejects (old client, code 4002)', async () => {
    const shareLink = vi.fn(() => Promise.reject({ code: 4002, message: 'Invalid command' }));
    mockClipboard(async () => undefined);
    expect(await shareResult(env(true, shareLink), TEXT, 'birdle-7')).toBe('copied');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(TEXT);
  });

  it('never calls shareLink in mock mode', async () => {
    const shareLink = vi.fn();
    mockClipboard(async () => undefined);
    expect(await shareResult(env(false, shareLink), TEXT, 'birdle-7')).toBe('copied');
    expect(shareLink).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when the clipboard API is blocked', async () => {
    mockClipboard(() => Promise.reject(new DOMException('blocked', 'NotAllowedError')));
    const execCommand = mockExecCommand(() => true);
    expect(await shareResult(env(false), TEXT, 'birdle-7')).toBe('copied');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull(); // helper textarea removed
  });

  it('asks for a manual copy when every method fails', async () => {
    mockClipboard(undefined);
    mockExecCommand(() => {
      throw new Error('not supported');
    });
    expect(await shareResult(env(false), TEXT, 'birdle-7')).toBe('manual');
  });

  it('copyText returns false when execCommand reports failure', async () => {
    mockClipboard(undefined);
    mockExecCommand(() => false);
    expect(await copyText(TEXT)).toBe(false);
  });
});
