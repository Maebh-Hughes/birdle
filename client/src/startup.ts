import { ApiError } from './api';
import { describeError } from './discord/errors';
import { MissingClientIdError } from './discord/sdk';

/** What the error screen says when BIRDLE can't even set up Discord. */
export interface StartupFailure {
  title: string;
  message: string;
  detail?: string;
}

/** Player-facing text for a failure of createDiscordEnv (before any sign-in). */
export function startupFailure(error: unknown): StartupFailure {
  if (error instanceof MissingClientIdError) {
    return {
      title: 'BIRDLE isn’t set up for Discord yet',
      message: 'This BIRDLE server has no Discord application ID, so it can’t sign you in.',
      detail: 'Server owner: set DISCORD_CLIENT_ID (the Client ID from the Discord Developer Portal), restart BIRDLE and relaunch the Activity.',
    };
  }
  if (error instanceof ApiError && error.code === 'NETWORK') {
    return { title: 'No connection', message: 'Can’t reach the BIRDLE server. Check your connection and try again.' };
  }
  return {
    title: 'BIRDLE couldn’t start',
    message: 'Something went wrong while connecting to Discord.',
    detail: describeError(error),
  };
}
