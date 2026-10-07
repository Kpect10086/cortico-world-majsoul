import type { WorldDefinition } from 'cortico/world.ts';
import { MAJSOUL_DEFAULTS, type MajsoulConfigSection } from './config.ts';
import { MajsoulWorld } from './world.ts';
export const MAJSOUL: WorldDefinition<MajsoulConfigSection> = { id: 'majsoul', label: '雀魂麻将', defaults: () => ({ ...MAJSOUL_DEFAULTS }), create: ctx => new MajsoulWorld(ctx) };
export default MAJSOUL;
