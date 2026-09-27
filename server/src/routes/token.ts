import { Router } from 'express';
import type { TokenResponse } from '@birdle/shared';
import { DiscordApiError, DiscordNotConfiguredError, type DiscordClient } from '../discord';
import { DiscordBusyError } from '../discordGuard';
import { ApiError } from '../errors';
import type { Logger } from '../runtime';
import { bodyObject } from '../validate';

const MAX_CODE_LENGTH = 512;

/** POST /api/token { code } -> { access_token }: the Discord OAuth2 code exchange (no auth required). */
export function tokenRoutes(discord: DiscordClient, logger: Logger): Router {
  const router = Router();

  router.post('/token', async (req, res) => {
    const code = bodyObject(req).code;
    if (typeof code !== 'string' || code.trim() === '' || code.length > MAX_CODE_LENGTH) {
      throw new ApiError('BAD_REQUEST', 'Missing OAuth2 code');
    }
    let accessToken: string;
    try {
      accessToken = await discord.exchangeCode(code);
    } catch (error) {
      if (error instanceof DiscordNotConfiguredError) {
        throw new ApiError('BAD_REQUEST', 'Discord sign-in is not configured on this server', 503);
      }
      if (error instanceof DiscordBusyError) {
        throw new ApiError('BAD_REQUEST', 'Too many sign-ins right now. Please try again in a minute.', 429);
      }
      if (error instanceof DiscordApiError) {
        logger.warn(error.message);
        throw new ApiError('BAD_REQUEST', "Couldn't complete Discord sign-in. Please try again.", 502);
      }
      throw error;
    }
    const body: TokenResponse = { access_token: accessToken };
    res.json(body);
  });

  return router;
}
