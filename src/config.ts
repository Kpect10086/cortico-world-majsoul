import type { ConfigGroup } from 'cortico/core/types.ts';
export interface MajsoulConfigSection { enabled: boolean; allowActions: boolean; browserPort: number; gameUrl: string; commandTimeoutSec: number; decisionTargetMs: number; newRoundDelayMs: number; }
export const MAJSOUL_DEFAULTS: MajsoulConfigSection = { enabled: false, allowActions: false, browserPort: 29733, gameUrl: 'https://game.maj-soul.com/1/', commandTimeoutSec: 8, decisionTargetMs: 5000, newRoundDelayMs: 4000 };
export const MAJSOUL_CONFIG_GROUP: ConfigGroup = {
  id: 'world:majsoul', owner: 'world:majsoul',
  schema: { type: 'object', title: '雀魂麻将', properties: {
    'worlds.majsoul.allowActions': { type: 'boolean', title: '允许操作当前牌局', 'x-hot': true },
    'worlds.majsoul.browserPort': { type: 'integer', title: '专用 Edge 调试端口', minimum: 1024, maximum: 65535 },
    'worlds.majsoul.gameUrl': { type: 'string', title: '雀魂网页地址', enum: ['https://game.maj-soul.com/1/', 'https://game.maj-soul.net/1/', 'https://mahjongsoul.game.yo-star.com/', 'https://game.mahjongsoul.com/'] },
    'worlds.majsoul.commandTimeoutSec': { type: 'integer', title: '提交后等待回执（秒）', minimum: 2, maximum: 30, 'x-hot': true },
    'worlds.majsoul.decisionTargetMs': { type: 'integer', title: '出牌决策目标（毫秒）', minimum: 1000, maximum: 60000, description: '提示与耗时比较，不保证模型能达到，也不自动代打。', 'x-hot': true },
    'worlds.majsoul.newRoundDelayMs': { type: 'integer', title: '庄家开局首个操作等待（毫秒）', minimum: 0, maximum: 8000, description: '从接收新回合起计，等待发牌阶段结束；后续操作不等待。', 'x-hot': true },
  } },
};
