import type { EventPayloadData, IDiscordSDK } from '@discord/embedded-app-sdk';
import { describeError } from './errors';

const PARTICIPANTS_EVENT = 'ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE';

export type ParticipantsUpdate = EventPayloadData<typeof PARTICIPANTS_EVENT>;
export type Participant = ParticipantsUpdate['participants'][number];

/** Display name as Discord shows it: nickname, then global name, then username. */
export function participantName(participant: Participant): string {
  return participant.nickname?.trim() || participant.global_name?.trim() || participant.username;
}

/**
 * cdn.discordapp.com/avatars/ is on the Activity CSP allow-list; default avatars
 * (/embed/avatars/) are not, so a missing avatar yields null (render initials).
 */
export function participantAvatarUrl(participant: Participant, size = 64): string | null {
  if (!participant.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${participant.id}/${participant.avatar}.png?size=${size}`;
}

/** Removes `handler`; false if the SDK refused (the listener then stays registered). */
async function unsubscribe(sdk: IDiscordSDK, handler: (update: ParticipantsUpdate) => void): Promise<boolean> {
  try {
    await sdk.unsubscribe(PARTICIPANTS_EVENT, handler);
    return true;
  } catch (error) {
    console.warn('BIRDLE: could not unsubscribe from participants:', describeError(error));
    return false;
  }
}

/**
 * Subscribes to instance participant changes, then fetches the current snapshot
 * (subscribing first so no change falls into the gap). The snapshot is fetched
 * even if Discord refuses the subscription. Never rejects; returns a stop function.
 */
export async function watchParticipants(
  sdk: IDiscordSDK,
  onChange: (participants: Participant[]) => void,
): Promise<() => Promise<void>> {
  let sawUpdate = false;
  // Keep this exact reference: unsubscribe only removes the listener it is given.
  const handler = (update: ParticipantsUpdate) => {
    sawUpdate = true;
    onChange(update.participants);
  };

  let registered = true;
  try {
    await sdk.subscribe(PARTICIPANTS_EVENT, handler);
  } catch (error) {
    console.warn('BIRDLE: live participant updates unavailable:', describeError(error));
    // The SDK registers the listener before sending SUBSCRIBE and keeps it when
    // Discord refuses; while it stays, a later subscribe would send no SUBSCRIBE.
    registered = !(await unsubscribe(sdk, handler));
  }

  try {
    const { participants } = await sdk.commands.getInstanceConnectedParticipants();
    if (!sawUpdate) onChange(participants);
  } catch (error) {
    console.warn('BIRDLE: could not read Activity participants:', describeError(error));
  }

  return async () => {
    // Unsubscribing a listener that is gone could end another watcher's subscription.
    if (registered) registered = !(await unsubscribe(sdk, handler));
  };
}
