# `src/world.ts`：Cortico 雀魂麻将扩展

让你的Cortico角色读取雀魂牌局，并在你允许后自主出牌。扩展提供自己的手牌、公开牌河、副露、当前合法操作和牌效分析；角色负责决定打法，扩展负责执行动作并核对服务器回执。

支持四人麻将和三人麻将。登录账号、创建房间、匹配和局间结算确认由你操作。首次使用建议开友人房加AI测试。

| 项目 | 信息 |
| --- | --- |
| 作者与维护者 | [Kpect10086](https://github.com/Kpect10086) |
| 版本 | 1.0.2 |
| 首版打包日期 | 2026-10-07 |
| 许可 | MIT |
| 源码与反馈 | [GitHub 仓库](https://github.com/Kpect10086/cortico-world-majsoul) · [Issues](https://github.com/Kpect10086/cortico-world-majsoul/issues) |

**Windows 下载：[最新 Release](https://github.com/Kpect10086/cortico-world-majsoul/releases/latest)**，选择附件 `cortico-world-majsoul-1.0.2.zip`。解压后先启动自己的 Cortico，再双击包内 `start-majsoul.cmd`。首次入口会安装依赖、从雀魂官方准备协议、登记扩展并请求 Cortico 重新加载。

ZIP 是需要联网完成首次设置的安装包；它不包含 Node.js、Edge、Cortico 或角色配置。Release 中自动生成的 `Source code` 是源码快照，推荐下载上面指定的 ZIP 附件。npm 当前可用版本请以[注册表](https://www.npmjs.com/package/cortico-world-majsoul)为准；`1.0.0` 使用下面的旧版 npm 步骤。

## 使用前准备

- Windows和Microsoft Edge浏览器。
- Node.js 22.15或以上，安装时包含npm。
- 已经能正常启动、使用模型并对话的Cortico角色，框架需要支持World API 5。本扩展开发类型契约使用Cortico 0.1.6。
- 你自己的雀魂账号。登录在扩展打开的专用Edge浏览器中完成。

本扩展提供游戏观察与操作工具。语音、Live2D和直播输出使用你原有的Cortico配置。

## 已安装 npm 1.0.0 的用户

在Cortico控制台的“扩展 → World”中搜索 `cortico-world-majsoul` 并安装。安装完成后，先准备游戏协议，再重启Cortico。npm包不包含游戏协议资源；跳过这一步会导致扩展加载失败。

在PowerShell中执行，将路径换成自己的Cortico框架目录：

```powershell
Set-Location "<Cortico框架目录>\extensions\node_modules\cortico-world-majsoul"
npm.cmd run prepare:protocol
```

如果设置过 `CORTICO_EXTENSIONS_DIR`，将上述 `extensions` 路径换成该配置的扩展目录。协议准备成功后，按原来的方式重启Cortico；继续下面第3步确认框架和部署目录，再从这个npm包目录运行 `start-majsoul.cmd`。

## 从 Release 安装与开局

### 1. 下载并解压

打开[最新 Release](https://github.com/Kpect10086/cortico-world-majsoul/releases/latest)，下载 `cortico-world-majsoul-1.0.2.zip`，解压到准备长期保留的位置。打开解压后的文件夹，确认里面有 `package.json`、`src`、`setup` 和 **`start-majsoul.cmd`**。本地扩展安装接口目前接受英文、数字和空格路径，请选不含中文的目录。

下面的“扩展目录”指包含这个 `package.json` 的文件夹，不是ZIP文件，也不是它的上一级目录。安装后请保留这个文件夹；本地安装会引用其中的文件。

### 2. 首次设置由入口完成

无需手动执行 npm 命令。下面第4步的入口会检查 Node.js 版本，补齐缺少的运行依赖，下载协议并核对 SHA256。首次设置需要能访问 npm 注册表和雀魂官方资源；失败会停止并显示错误。

开发者使用 **Code → Download ZIP** 或 Git 克隆时也能使用同一入口。需要自行准备开发环境和运行测试时，在包含 `package.json` 的扩展目录执行：

```powershell
npm.cmd install --ignore-scripts
npm.cmd run prepare:protocol
```

正常安装只需继续第3、4步。协议尚未准备时，1.0.2 仍可被 Cortico 加载；连接牌局会提示运行入口准备协议。

### 3. 启动自己的Cortico

按你原来的方式启动Cortico，确认控制台可以打开。记下两个目录：

| 入口参数 | 应填写的目录 |
| --- | --- |
| `FrameworkDir` | Cortico框架根目录，其中有框架的 `package.json`、`src` 和 `extensions` 目录。 |
| `DeploymentDir` | 你当前运行的Bot部署目录，其中有该部署的配置和 `data` 目录。不要填整个 `deployments` 父目录。 |

入口会核对控制台是否属于指定部署。默认控制台地址是 `http://127.0.0.1:7788`；如果你使用别的端口，下一步同时传入 `-ConsoleUrl "http://127.0.0.1:<你的端口>"`。

### 4. 运行游戏入口

**直接双击 `start-majsoul.cmd`**，根据提示粘贴框架目录和当前部署目录，按回车。入口会自动完成第2步；不要在 ZIP 内直接运行。也可在扩展目录的 PowerShell 中执行以下命令，把两个路径占位符换成实际目录：

```powershell
.\start-majsoul.cmd -FrameworkDir "<Cortico框架目录>" -DeploymentDir "<当前Bot部署目录>"
```

这个入口会登记当前包所在目录、启用雀魂 World、打开“允许操作当前牌局”、让角色能看到该World、连接专用Edge浏览器，并恢复角色运行。**运行这个入口表示允许角色操作牌局。** 扩展本身的默认操作权限是关闭的。只旁观时使用下方 `-ObserveOnly` 命令。

首次安装需要Cortico进程重新加载扩展。如果你原来的启动方式带有受监督启动器，入口会请求重启一次；如果提示需手动重启，就按原来的方式重启Cortico，再执行入口。刷新控制台网页不能加载新扩展代码。

如果想让角色旁观、自己打牌，在同一命令后加 `-ObserveOnly`：

```powershell
.\start-majsoul.cmd -FrameworkDir "<Cortico框架目录>" -DeploymentDir "<当前Bot部署目录>" -ObserveOnly
```

### 5. 登录雀魂并手动开局

在入口打开的**专用 Edge 窗口**中登录雀魂。这个窗口使用独立浏览器资料，可能需要重新登录；普通Edge或其他浏览器里已经打开的雀魂页面不会自动接入。

默认打开中国服务器 `https://game.maj-soul.com/1/`。其他服务器用户可先在 Cortico的“雀魂麻将”World配置中选择“雀魂网页地址”，然后运行入口。

你手动创建友人房或匹配，进入牌局后，角色通过牌局事件接收状态并决定操作。首次建议友人房加AI，并选择宽松计时；模型或网络延迟可能使出牌赶不上倒计时。

### 6. 确认连接与权限

在Cortico控制台打开“雀魂麻将”World，检查：

- “牌局桥接”显示在线。
- “游戏操作”显示允许；旁观模式应显示暂停。
- 进入牌局后，“游戏状态”的 `state` 查询包含自己的手牌和公开牌局信息。

也可以让角色调用 `majsoul_status` 核对：`connected` 为 `true`，自动操作时 `allowActions` 为 `true`，收到完整牌局时 `observation.complete` 为 `true`。大厅没有手牌是正常状态。

## 日常使用与暂停

- **再次启动：** 启动自己的Cortico后，双击 `start-majsoul.cmd` 输入目录，或执行同一条带目录参数的命令。已有连接会被复用。
- **局间确认：** 回合结算或整场结束需要点击确认时，由你操作。登录、建房和匹配同样由你完成。
- **暂停代打：** 在“雀魂麻将”World 配置中关闭“允许操作当前牌局”，即时生效。也可使用 `-ObserveOnly` 入口切换为旁观。
- **断线：** 先查看连接状态；角色的 `majsoul_reconnect` 会重新附着桥接并等待客户端认证，不刷新游戏页面。不要连续刷新或反复重发结果未知的动作。
- **停用：** 在控制台停用雀魂 World，已有游戏浏览器会保留。
- **更新 Release：** 解压新版到英文路径，启动自己的 Cortico，再运行新版 `start-majsoul.cmd`。入口会登记新版目录并请求重启加载；部署配置与浏览器资料保留在原部署目录。没有受监督启动器时，按提示手动重启 Cortico，再执行入口。

## 常见问题

| 现象 | 检查方式                                                       |
| --- |------------------------------------------------------------|
| `npm.cmd` 或Node命令找不到 | 确认已安装Node.js与npm，重新打开PowerShell后再执行。                       |
| Node版本过低 | 执行 `node -v` 核对实际版本；安装22.15或以上后，检查PATH或Nodist是否仍选择旧版Node。 |
| 下载后没有 `start-majsoul.cmd` | 重新下载 Release 的版本 ZIP 附件并完整解压，不要使用旧缓存或只下载单个源码文件。 |
| 提示先准备协议、协议下载失败或SHA256不匹配 | 回到扩展目录重新运行 `npm.cmd run prepare:protocol`，检查网络和错误信息；校验失败时不要跳过检查。 |
| 控制台连接失败 | 先启动Cortico，确认控制台可访问；非默认端口传入正确的 `-ConsoleUrl`。              |
| 提示“当前控制台不是指定部署” | 检查 `DeploymentDir` 是否为这个控制台实际运行的部署，不要通过修改身份校验绕过错误。         |
| 扩展已安装但没有“雀魂麻将”World | 重启 Cortico 进程加载扩展；如果仍没有，查看控制台的扩展加载错误。                      |
| 能打开游戏，但角色看不到牌局 | 确认使用入口打开的专用Edge浏览器，在该窗口登录并开局；检查“牌局桥接”和状态查询。                |
| 角色能读牌但不操作 | 检查 World 已启用、对角色可见、操作权限已允许、Cortico正在运行；以实时工具回执判断原因。        |
| 回执为 `unknown` | 动作可能已经执行，先读取最新状态，不要自动重发同一个动作。                              |
| 提示浏览器端口属于其他浏览器 | 在雀魂 World配置中选择未占用的“专用 Edge 调试端口”，重建World使端口配置生效后重新运行入口。    |
| 包目录移动后无法加载 | 在控制台重新登记新的本地扩展目录，再重启Cortico；保留原有部署数据。                      |
| 信息页发布日期、体积或维护者为空 | 这些字段来自npm注册表；检查网络并刷新扩展列表，作者和版本也可查看上方信息表。 |

## 接口与限制

- `majsoul_status` / `majsoul_observe`：读取当前权限、连接、公开状态和牌效。
- `majsoul_act`：出牌、立直、吃碰杠、胡牌、九种九牌、三麻拔北或跳过；仅接受当前服务器合法动作。
- `majsoul_reconnect`：断线后重新附着桥接，不刷新页面、不重发未知结果的动作。

观察不包含对手暗手、牌山、登录令牌或原始网络流量。`handAnalysis` 由 [majiang-core](https://github.com/kobalab/majiang-core) 本地计算向听、公开未见进张、特殊路线和舍牌振听；不计算完整牌值、同巡振听或胜率。攻守仍由模型决定。

每份观察有 version，同一连接只等待一个动作；权威动作和服务器响应匹配后确认结果。超时、断线或取消返回结果未知，不自动重试。缺失动作、未知动作和不能完整恢复的特殊规则停止自动操作。决策目标不是限时保证，模型和网络延迟可能超出倒计时。声音由部署已有发声World 提供。

专用浏览器登录资料仅保存在使用者自己的 `<部署目录>/data/majsoul/edge-profile`，动作耗时保存在同级 `actions.jsonl`，不应提交这些运行文件。调试端口仅供本机使用。

## 验证

```powershell
npm test
npm run typecheck
```

在Cortico源码目录运行 `pnpm check:extension <本包目录>`。测试使用临时目录、无界面Edge和本机模拟游戏服务器，不登录真实游戏；覆盖协议、权限、三人麻将、庄家首操作、回执、拒绝、取消、超时与重连。该验证不证明所有线上规则、实际模型反应速度或长时间运行均已通过。

## 来源与许可

自行编写的代码采用MIT，见LICENSE。依赖各自的许可证保留在其包内。雀魂协议定义属于游戏发布方，由使用者从官方地址准备，不受本包MIT许可覆盖。

- [雀魂网页](https://game.maj-soul.com/1/)
- [协议定义来源](https://game.maj-soul.com/1/v0.11.243.w/res/proto/liqi.json)：SHA256 `f2955c3d10cf2d42bee9309f672c062540941ea0cffe1bd62e3f436c7afc404c`
- [Naki 协议说明](https://github.com/Sunalamye/Naki/blob/main/docs/majsoul-unity-protocol.md)：消息封装参考，不包含其实现或模型。
- [Playwright CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
- [Cortico 扩展契约](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/extensions.md)

这是第三方扩展，与游戏官方没有隶属关系；使用前自行确认游戏服务对自动操作的要求。
