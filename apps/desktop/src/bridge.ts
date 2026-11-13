// What the app answers when Studio asks. Two calls, each checked against the sender's address
// here in the main process. The preload's own check only keeps the object off other pages.

import { mayAnswerStudio } from './locality';

export const SETUP_CODE_CHANNEL = 'openldr-desktop:setup-code';
export const INFO_CHANNEL = 'openldr-desktop:info';

/** The only words a failed setup code request gives the page. The cause stays in the main process. */
export const SETUP_CODE_FAILED = 'The setup code could not be made.';

export interface BridgeDeps {
  /** The launcher's address when the app may answer Studio on it. Pass `bridgeAddress`, not `address`. */
  address(): string | undefined;
  requestSetupCode(): Promise<string>;
  info(): { version: string; platform: string };
}

/** The two handlers, keyed by channel. Each takes the sender's frame URL. */
export function bridgeHandlers(deps: BridgeDeps): Record<string, (senderUrl: string) => Promise<unknown>> {
  const check = (senderUrl: string): void => {
    if (!mayAnswerStudio(senderUrl, deps.address())) throw new Error('not allowed');
  };
  return {
    [SETUP_CODE_CHANNEL]: async (senderUrl) => {
      check(senderUrl);
      try {
        return await deps.requestSetupCode();
      } catch {
        throw new Error(SETUP_CODE_FAILED);
      }
    },
    [INFO_CHANNEL]: async (senderUrl) => {
      check(senderUrl);
      const { version, platform } = deps.info();
      return { version, platform };
    },
  };
}
