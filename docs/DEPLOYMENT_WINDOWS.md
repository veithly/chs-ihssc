# 价序 · Windows 内网部署运行说明

> 适用环境：医保内网 Windows 云桌面 / 虚拟机（8C16G 足够，无 GPU 要求，**全程无外网**）。
> 一句话：解压 → 填一个配置文件 → 双击 `start.bat`，10 分钟内可演示。
> 内网唯一外部调用是大模型 API（OpenAI 兼容 `/chat/completions`），把地址指到内网千问即可；其余全部本地运行。

---

## 0. 包里有什么（jiaxu-win64-offline.zip）

| 路径 | 说明 |
|------|------|
| `start.bat` | 一键启动（默认 3000 端口；`start.bat 8080` 换端口） |
| `verify.bat` | 部署后自动验证（smoke 15 项 + verify 17 项） |
| `reseed.bat` | 一键重置演示数据（每轮演示前跑一次） |
| `.env.local.example` | 内网千问配置模板 |
| `node\` | Node.js v24 LTS win-x64 运行时，**免安装**、免管理员权限 |
| `app\` | 应用本体（Next.js standalone 产物 + 精简 node_modules，纯 JS 无原生二进制） |
| `app\public\samples\settlement-sample.csv` | 演示上传用样例表 |
| `app\data\` | SQLite 数据目录（首次启动自动建库并生成演示数据） |
| `materials\` | 摊位材料：deck PDF、演示手册 DEMO_PLAYBOOK |

不需要安装 Node、不需要 npm install、不需要数据库服务、不需要联网。
数据库用 Node 内建 `node:sqlite` 单文件库，随进程走，零依赖。

---

## 1. 部署步骤（内网机器上）

### 1.1 解压

右键 zip → 全部解压缩，建议解压到无中文、无空格的路径，例如 `D:\jiaxu\`。
（放中文路径通常也能跑，但排障时少一个变量。）

### 1.2 配置内网千问（唯一要动手的一步）

把包根目录的 `.env.local.example` 复制到 **`app\` 目录下**并改名为 `.env.local`，用记事本填三行：

```ini
OPENAI_API_KEY=主办方下发的统一token
OPENAI_BASE_URL=http://10.x.x.x:8000/v1
OPENAI_MODEL=qwen3-235b
```

- `OPENAI_BASE_URL` 填到 `/v1` 一级（不带 `/chat/completions`）。
- 三个值以主办方接口文档为准。
- 不填也能启动：页面、批次闸门、上传解析、规则引擎等确定性功能全部可用，只有需要大模型的环节会显示「未配置模型服务」。

### 1.3 启动

双击 `start.bat`（或命令行 `start.bat 8080` 指定端口）。看到

```
[价序] 启动后访问 http://localhost:3000
   ▲ Next.js 15.x
   - Local:  http://localhost:3000
```

即成功。浏览器打开 `http://localhost:3000`。首次打开会自动建库并生成 5 个演示批次（约 2 秒）。

> 同一内网的其他机器可通过 `http://本机IP:3000` 访问（start.bat 已监听 0.0.0.0），
> 如访问不通是 Windows 防火墙拦截入站，参见第 4 节。

---

## 2. 部署后验证（5 分钟）

### 2.1 自动验证（推荐）

保持服务运行，双击 `verify.bat`：

- `smoke-agent`：15 项接口冒烟（页面可达、扫描闭环、审批链路等）
- `verify-v2`：17 项 V2 全链路（政策同步离线预置、漂移检出、规则挖掘/激活/自动复用、审计留痕）

两个都全绿即可开演。未配置 `.env.local` 时，涉及大模型的少数用例会失败，属预期。

### 2.2 手动走一遍演示主线（对照演示手册）

| # | 动作 | 预期 |
|---|------|------|
| 1 | 打开 `/`（首页） | 实时统计非零 |
| 2 | `/release/REL-2026-0623-07` 点「启动扫描」 | 42 行扫描，出差比价折算超限 + 红/黄预警徽标 |
| 3 | `/workspace` 上传 `app\public\samples\settlement-sample.csv`，指令「按最新政策核对执行价并出处置提案」 | 字段映射 → 归并 → 核验任务生成 |
| 3.5 | 回答下方「价序的处置提案」卡：改一条修复值点「采纳并回写」，批准一条任务 | 修复值回写数据集、任务状态就地更新，审计日志留痕 |
| 4 | 「政策事实」点 `政策变更演示 640→560` 后重跑 | 漂移队列检出存量执行价漂移 |
| 5 | 人审批 3 条 → 「从人审结论整理规则」→ 影响面预览 → 激活 → 再跑一批 | 命中规则自动处置，敏感项仍人审 |
| 6 | 任一任务「处置结果单」 | 报告页正常渲染 |

---

## 3. 日常运维

| 事项 | 操作 |
|------|------|
| 重置演示数据 | 服务运行中双击 `reseed.bat`（游园会每轮开演前跑一次） |
| 停止服务 | 启动窗口按 `Ctrl+C`（或直接关窗口） |
| 换端口 | `start.bat 8080` |
| 演示前快照 | 停止服务后复制 `app\data\` 整个目录；恢复=拷回再启动 |
| 换模型配置 | 改 `app\.env.local` 后重启（配置在进程内有缓存） |
| 查日志 | 启动窗口的控制台输出即服务端日志 |

---

## 4. 常见问题排障

| 现象 | 原因 | 处理 |
|------|------|------|
| 双击 start.bat 一闪而过 | 端口被占用 / 路径异常 | `cmd` 里手动运行 `start.bat` 看报错；`netstat -ano \| findstr :3000` 查占用，换端口启动 |
| 其他机器访问不通 | Windows 防火墙拦入站 | 管理员 PowerShell：`netsh advfirewall firewall add rule name="jiaxu" dir=in action=allow protocol=TCP localport=3000`；或演示时只用本机 |
| 模型调用报 `auth_failed` | token 错/失效 | 核对 `app\.env.local` 三个值；系统会诚实展示失败态，不会假成功 |
| 模型调用报 4xx（response_format） | 内网千问不支持 `json_object` | 已内置自动去参重试，无需处理（`src/lib/provider.ts` 兼容层） |
| 单次运行超时 | 235B 模型响应慢 | 90s 超时自动写降级 run（`provider_timeout`），重跑即恢复；不影响已完成步骤 |
| 「政策同步」抓取失败 | 内网访问不了医保局官网 | 预期行为。两条离线路径：① 预置 3 条离线公告（含 38 号函 560 元中选价）；② 政策事实 tab「上传政策文件」直接收 PDF/CSV/XLSX/DOCX（CSV 自动解析价格事实建议，人审确认后生效），全程不需要外网 |
| 杀毒软件拦截 node.exe | 白名单问题 | node.exe 是 nodejs.org 官方原版（zip 附 sha256 可校验），请 IT 加白 |
| 数据乱了想彻底重来 | — | 停服务 → 删 `app\data\` 下所有 `.db*` 文件 → 重启（自动重建+种子） |

---

## 5. 架构与合规要点（被追问时用）

- **全栈离线**：Next.js standalone 产物 + Node 内建 SQLite 单文件库 + 预置政策公告，无 CDN、无外部字体、无遥测外呼。唯一网络调用是 `.env.local` 里配置的模型地址。
- **数据安全**：所有演示数据为合成数据（`app\data\` 本地生成）；上传的 CSV 只进本机 SQLite，不出内网。
- **模型边界**：模型只产出计划与草稿；状态变更、审批、护栏全在服务端代码里，敏感操作（集采超价、编码失效等）硬编码永远人审。
- **审计**：每次运行的工具调用、决策日志、回放时间线全部落库，`/release/<id>/replay` 可全程回放。

---

## 6. 重新打包（外网开发机上）

包由脚本一键生成，改代码后重打：

```bash
node scripts/package_offline_win.mjs            # 构建 + 下载 Node 运行时(有缓存) + 组包 + zip
node scripts/package_offline_win.mjs --skip-build   # 复用上次构建产物，只重新组包
```

产物：`dist-offline/jiaxu-win64-offline.zip`（附 `.sha256` 校验文件）。
Linux 内网机器的部署方式见 `docs/DEPLOYMENT_OFFLINE.md`。
