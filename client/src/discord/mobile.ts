import { Common, RPCErrorCodes } from '@discord/embedded-app-sdk';
import { describeError, sdkErrorCode } from './errors';
import type { DiscordEnv } from './sdk';

/** Locks Discord mobile to portrait (the board + keyboard need the height). No-op elsewhere. */
export async function lockPortraitOnMobile(env: DiscordEnv): Promise<void> {
  if (!env.embedded || env.platform !== 'mobile') return;
  const portrait = Common.OrientationLockStateTypeObject.PORTRAIT;
  try {
    await env.sdk.commands.setOrientationLockState({
      lock_state: portrait,
      picture_in_picture_lock_state: portrait,
      grid_lock_state: portrait,
    });
  } catch (error) {
    // 4002 = client too old for this command; nothing to do.
    if (sdkErrorCode(error) !== RPCErrorCodes.INVALID_COMMAND) {
      console.warn('BIRDLE: setOrientationLockState failed:', describeError(error));
    }
  }
}
