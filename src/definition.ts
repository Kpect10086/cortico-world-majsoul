import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { MAJSOUL_DEFAULTS, type MajsoulConfigSection } from './config.ts';
import { MAJSOUL_TOOL_DECLS, MajsoulWorld } from './world.ts';
export const MAJSOUL: WorldDefinition<MajsoulConfigSection> = {
  id: 'majsoul', label: '雀魂麻将', defaults: () => ({ ...MAJSOUL_DEFAULTS }), create: ctx => new MajsoulWorld(ctx),
  describe: {
    tools: describeTools(MAJSOUL_TOOL_DECLS, {
      majsoul_status: '读取实时权限、连接、公开牌局和牌效。',
      majsoul_observe: '读取最新公开牌局与状态版本。',
      majsoul_reconnect: '重新附着专用浏览器的牌局桥接。',
      majsoul_act: '提交一个合法动作并等待服务器回执。',
    }),
    events: [{ type: 'majsoul.state', description: '公开牌局、连接或动作回执发生变化；根据操作窗口与权限投递。', tags: ['snapshot'] }],
  },
};
export default MAJSOUL;
