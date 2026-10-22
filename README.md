# 雀魂麻将 — src/world.ts

## 安装与依赖

需要 Windows、Microsoft Edge、Node.js 22.16+、Cortico 0.2.4 / World API 6，以及可用的模型连接和用户自己的雀魂账号。扩展页安装 **cortico-world-majsoul@1.1.1** 后重启。依赖 @kobalab/majiang-core、playwright-core、protobufjs 自动安装；不额外下载整套 Chromium。源码目录首次使用需 npm install，启动器会补装运行依赖。

已附官方公开协议 assets/liqi.json，默认无需额外下载；缺失时启动器调用 setup/fetch-protocol.mjs 从官方获取并核对固定 SHA256。游戏升级导致协议不符时需更新扩展，不绕过版本或校验。已编译的面板随包提供。

双击 start-majsoul.cmd 输入框架根目录、当前 bot 部署目录；控制台非默认地址时用命令行 -ConsoleUrl 传入。启动器只接管部署专属 Edge，首次安装可能请求 Cortico 自身重启。手动登录并在友人房添加 CPU，局间确认仍需手动。默认自动操作关闭，启动器或面板可启用；-ObserveOnly 仅观察。模型和网络影响反应时间，5 秒是目标。

升级保留部署 data/majsoul，包不含账号、浏览器资料或真实日志。协议与游戏资源归原游戏权利人，LICENSE 仅覆盖自行编写的代码。

## 功能与运行

# `src/world.ts`：雀魂麻将 World

使用当前 Unity 网页客户端的 Liqi 消息读取公开牌局，由模型通过 `majsoul_act` 选择动作。浏览器桥接监听 `/game-gateway` 与 `/gateway`，通过 `FastTest.authGame` 识别牌局连接；等待认证时重复连接不会再次刷新。无需油猴、修改游戏文件或安装额外浏览器扩展。

在扩展目录双击 start-majsoul.cmd，输入你自己的框架根目录与当前部署目录。也可传入 -FrameworkDir、-DeploymentDir 和 -ConsoleUrl。首次安装后需重启 Cortico；专用 Edge 中手动登录，进入友人房添加 CPU 并开始牌局。

控制台“游戏状态”面板通过 manifest 的 cortico.webUiClient 加载 src/webui/client.js，已随包提供，无需另行构建。

`-ObserveOnly` 可关闭自动动作：`powershell -File setup\start-game.ps1 -ObserveOnly`。控制台的“允许操作当前牌局”可热切换。再次打开入口会复用已附着的游戏页面；结算后连接关闭时等待下一局或开局，操作结果未知时不重发动作。停用 World 保留 Edge 与游戏页面。

专用页面默认将 `requestAnimationFrame` 限制为 30 FPS，减少渲染负担；服务器消息、操作与回执保持原调度。控制台“网页渲染帧率上限”可设为 15–60，下一次连接页面时生效。安装新桥接前已打开的旧页面需由操作者刷新。实际游戏 GPU 占用需在打开雀魂后测量。

工具：`majsoul_status` / `majsoul_observe` 读取状态；`majsoul_reconnect` 在允许操作且断线时重新附着桥接，保留游戏页面，不触发刷新；已经连通或本局已结算时只读取状态。`majsoul_act` 提交出牌、立直、吃、碰、暗杠、明杠、加杠、自摸、荣和、九种九牌、三麻拔北或跳过。只能使用当前服务器给出的操作，索引来自当前 combinations。观察包含本人手牌、公开牌河、副露、宝牌指示牌和点数；对手摸牌与暗手、牌山、登录凭据不进入模型观察或动作日志。

状态与事件的 `handAnalysis` 提供中文整理手牌、摸牌和当前合法弃牌的向听数、有效进张、合法立直标记及对立直家的现物。使用 [majiang-core](https://github.com/kobalab/majiang-core) 本地计算一般形、七对子和国士无双，不需要额外模型调用。进张数扣除公开可见牌，是未见张数上限；牌效排序不含完整役、点数期望或副露价值评估，攻守与动作仍由模型决定。

三麻人数以 authGame 的座位数为准，四格分数消息不创建第四位玩家，重连动作重放保留实际人数。`handAnalysis` 还提供门清、自风、场风、役牌牌种和舍牌振听（包括候选弃牌造成的振听）；不推测同巡或立直见逃状态，胡牌合法性仍以服务器操作为准。环境提示词补充有役、门清、副露、振听和三麻规则，牌效不是完整打牌策略。

轮到本人时用框架的 preempt 事件立即投递，并请求取消尚未外化的旧思考；Core 已经产生外部输出时仍可能等待旧调用结束。对手普通弃牌只随下一次唤醒提供。默认决策目标为五秒，有操作窗口时直接使用事件状态提交动作。普通操作默认安静，关键变化确认后才考虑短句解说；主动解说通常至少间隔 30 秒，已有台词未播完时省略新的普通解说。有效直接问题在操作窗口解除且没有语音积压时优先简短回应，局后或明确要求时再展开。声音仍使用已有发声 World；该扩展不代替语音服务，模型和网络延迟仍可能超过决策目标。

验证入口：`pnpm test`、`pnpm typecheck`；框架目录使用 `pnpm check:extension <扩展目录>`。测试用真实 Edge 的无界面窗口和本机模拟游戏服务器，不登录真实雀魂。测试覆盖协议编码、公开信息过滤、红五、副露、合法操作、旧版本、浏览器序号检查、服务器拒绝、确认消息顺序、超时与重连。真实雀魂接受动作、吃碰杠各变体和实际五秒反应速度仍需用户实机验证。

动作日志为 `<部署目录>\data\majsoul\actions.jsonl`：`decisionMs` 是接收操作窗口至提交的时间，`acknowledgementMs` 是提交至匹配结果的时间。没有原始流量或凭据。`decisionTargetMs` 只是目标提示，不是自动选牌策略。庄家开局的首个操作从接收 `ActionNewRound` 起等待 `newRoundDelayMs`（默认四秒），兼容发牌阶段；等待后重新核对版本、连接与权限，提交后才开始回执超时计时。后续操作不加等待。timer.fixedMs 来自服务器固定计时毫秒；extraRaw 保留未实机核对单位的加时字段。

允许操作且已连接到完整的进行中牌局时，主 session 请求临时关闭思考；局后、断线、暂停操作、隐藏或停用 World 后恢复保存的模型档位。此能力需要框架支持 `World.suppressThinking()`；不改写供应商配置，后台认知请求保持原档位。状态中的 `fastMode` 表示雀魂当前是否请求快速模式。

恢复消息必须包含以 ActionNewRound 开头的完整动作序列；只有 snapshot 时暂停至下一局。未知动作、消息缺口和特殊规则暂停自动操作并报告 reason。每次成功非跳过动作需收到同 ID 的服务器 RESPONSE 与匹配权威动作；跳过的 server_accepted 仅代表服务器接受。禁打限制按牌种比较，红五和普通五一并禁止；handAnalysis.blockedDiscards 提供原因。提交前拒绝保留当前窗口，服务器明确拒绝且期间状态未变时恢复该窗口；失败回执提供最新合法候选。超时、取消、断线均返回 unknown，不恢复旧操作，也不清空期间新到的权威窗口。

接口与资源来源：

- 当前游戏页面：[雀魂网页](https://game.maj-soul.com/1/)，核对为 Unity WebGL `4.0.47(47)`。
- 协议字段：[游戏公开 liqi.json](https://game.maj-soul.com/1/v0.11.243.w/res/proto/liqi.json)，SHA256 `f2955c3d10cf2d42bee9309f672c062540941ea0cffe1bd62e3f436c7afc404c`。
- 消息编码与操作通道参考：[Naki 的协议说明](https://github.com/Sunalamye/Naki/blob/main/docs/majsoul-unity-protocol.md)。本包不包含其 Swift、JS、AI 模型或高亮实现。
- 浏览器连接：[Playwright CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)。
- 日麻通用概念：[WRC 2025 规则](https://www.worldriichi.org/wrc-rules) 的门清、有役与振听章节；其竞技赛事的起始点数、连庄、赤牌和特殊和牌规则不移植为雀魂规则。雀魂模式与友人房说明：[官方入门指南](https://mahjongsoul.com/startguide/)。具体房间与三麻动作以雀魂服务器为准。

`assets/liqi.json` 的协议定义属于原游戏；本包 LICENSE 仅适用于本包自行编写的代码。专属登录资料存入部署 data/majsoul/edge-profile；打包不包含该目录。

`src/render.ts` 渲染模型状态正文：完整保留操作索引、牌河标记、全部合法候选与进张，手牌只列一次。自动事件使用语义文本；读取、重连及失败回执的 `state` 为相同正文，`version`、`outcome`、`retry` 保持可直接使用。面板 `state` 仍返回原始对象。`majsoul.state.meta.connected/active` 供其他 World 读取场景。

