/** Start the private companion service before registering the existing Harness extensions. */
import { apply as applyRemembers } from './remembers.mjs';
import { launchService, readRuntime } from './runtime.mjs';

export const name = 'bili-whalemate';
export const inject = ['agents', 'sessions'];

/** Own the service until all later-registered consumers have been disposed. */
export async function apply(ctx, input = {}) {
  const config = readRuntime();
  await ctx.effect(async () => {
    const service = await launchService(config);
    return () => service.close();
  });
  applyRemembers(ctx, { ...input, endpoint: config.endpoint, memeDir: config.memeDir });
}
