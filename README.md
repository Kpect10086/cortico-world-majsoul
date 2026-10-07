# `src/world.ts`：雀魂麻将 World

Cortico 外部 World 扩展，通过专用 Edge 的 Liqi 消息读取公开牌局并提交版本校验的动作。支持四人立直麻将和普通三麻，默认不开启自动操作。需要 Windows、Microsoft Edge、Node.js 22.15+ 及 World API 5 的 Cortico；开发类型契约钉在 Cortico 0.1.6。

## 安装与开局

先在本包目录执行：

```powershell
npm install --ignore-scripts
npm run prepare:protocol
```

协议准备脚本从雀魂官方公开地址下载指定版本的协议定义，并核对 SHA256。本源码和安装包不包含该第三方文件；下载失败或校验不符时停止，不修改已有协议文件。

启动你的 Cortico 部署后，在扩展控制台选择本包目录安装，按提示重启并启用雀魂 World。Windows 也可运行以下入口，传入自己的路径：

```powershell
.\start-majsoul.cmd -FrameworkDir "<Cortico目录>" -DeploymentDir "<部署目录>"
```

入口确认控制台属于指定部署；未加载扩展时可通过受监督启动器重启一次。然后启用 World、允许当前牌局操作并打开部署专用 Edge。控制台不在默认 7788 端口时加 `-ConsoleUrl "http://127.0.0.1:<端口>"`。仅观察、手动游玩时加 `-ObserveOnly`。

在专用 Edge 手动登录并开局。首次建议友人房加 CPU、选择宽松计时。结算确认由操作者点击，再次打开入口复用已有连接；停用 World 保留浏览器。包目录被移动或删除后，本机 link 安装需重新登记。

## 接口与限制

- `majsoul_status` / `majsoul_observe`：读取当前权限、连接、公开状态和牌效。
- `majsoul_act`：出牌、立直、吃碰杠、胡牌、九种九牌、三麻拔北或跳过；仅接受当前服务器合法动作。
- `majsoul_reconnect`：断线后重新附着桥接，不刷新页面、不重发未知结果的动作。

观察不包含对手暗手、牌山、登录令牌或原始网络流量。`handAnalysis` 由 [majiang-core](https://github.com/kobalab/majiang-core) 本地计算向听、公开未见进张、特殊路线和舍牌振听；不计算完整牌值、同巡振听或胜率。攻守仍由模型决定。

每份观察有 version，同一连接只等待一个动作；权威动作和服务器响应匹配后确认结果。超时、断线或取消返回结果未知，不自动重试。缺失动作、未知动作和不能完整恢复的特殊规则停止自动操作。决策目标不是限时保证，模型和网络延迟可能超出倒计时。声音由部署已有发声 World 提供。

专用浏览器登录资料仅保存在使用者自己的 `<部署目录>/data/majsoul/edge-profile`，动作耗时保存在同级 `actions.jsonl`，不应提交这些运行文件。调试端口仅供本机使用。

## 验证

```powershell
npm test
npm run typecheck
```

在 Cortico 源码目录运行 `pnpm check:extension <本包目录>`。测试使用临时目录、无界面 Edge 和本机模拟游戏服务器，不登录真实游戏；覆盖协议、权限、三麻、庄家首操作、回执、拒绝、取消、超时与重连。该验证不证明所有线上规则、实际模型反应速度或长时间运行均已通过。

## 来源与许可

自行编写的代码采用 MIT，见 LICENSE。依赖各自的许可证保留在其包内。雀魂协议定义属于游戏发布方，由使用者从官方地址准备，不受本包 MIT 许可覆盖。

- [雀魂网页](https://game.maj-soul.com/1/)
- [协议定义来源](https://game.maj-soul.com/1/v0.11.243.w/res/proto/liqi.json)：SHA256 `f2955c3d10cf2d42bee9309f672c062540941ea0cffe1bd62e3f436c7afc404c`
- [Naki 协议说明](https://github.com/Sunalamye/Naki/blob/main/docs/majsoul-unity-protocol.md)：消息封装参考，不包含其实现或模型。
- [Playwright CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Cortico 扩展契约](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/extensions.md)

这是第三方扩展，与游戏官方没有隶属关系；使用前自行确认游戏服务对自动操作的要求。
