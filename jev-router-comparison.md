# Jev 路由接入与对照试验

## 实际路由（2026-09-24）

应用的 Ask 服务先检查本地裸词规则，再使用混合模型路由。需要模型分类时，Jev 通过设置中选定的渠道决定四个分类字段，默认保持 OpenRouter。每字段置信度均达到 0.8 且分类相容时采用其结果；此阈值是初始保守策略，尚未经过全面校准。

- 无历史、仅一个英文单词：本地默认走单词解释，保留原单词大小写，使用含义、音标、用法、例句四个默认模块，不调用 Jev 或原 Router。允许词内连字符和英文撇号；多个词、末尾问号及有历史的输入不命中。这是产品路由规则，不验证拼写或词典收录；`hello`、`help` 等裸词也按学习输入处理。
- 其他可信分类：当前回答模型补齐目标、关注点、模块和中文澄清问题；校验器要求保留 Jev 选定的分类字段。
- 缺少所选渠道凭证、低置信度、分类不相容、超时、接口失败或补齐失败：回到原 Router。取消请求不会触发回退。

回答生成与复核继续使用应用当前选择的模型。复杂请求会增加 Jev 调用，失败后可能增加补齐及回退耗时，不能保证整体提速。Jev 接收同一问题和当前请求的对话上下文；密钥仅在主进程读取。

在「设置 → Jev」可选择渠道并启用或关闭 Jev。各渠道的专用密钥独立保存；留空保存会保留该渠道已有密钥，勾选删除仅移除该渠道的密钥。切换时保留各渠道未保存的输入，点击保存只提交当前渠道。旧 `jevApiKey` 自动作为 OpenRouter 专用密钥使用，原回答模型不变。

| 渠道 | 模型 | Jev 页面配置 | HTTP 接口 |
| --- | --- | --- | --- |
| OpenRouter | `typesafe/jev-1.13` | 专用 API Key | `https://openrouter.ai/api/alpha/decisions` |
| Vercel AI Gateway | `typesafe-ai/jev` | 专用 Gateway API Key | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` |
| TypeSafe | `jev-latest` | 专用 TypeSafe API Key | `https://api.typesafe.ai/v1/systemone` |
| Cloudflare | `typesafe/jev` | 专用 API Token、Account ID | `https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run` |

Cloudflare 使用 `{ model, input: { state, questions } }`；其他渠道使用 `{ model, state, questions }`。Vercel 使用 TypeSafe 兼容接口，保留现有 Choice 的概率分布和独立 confidence 校验。模型字段由渠道确定，不提供任意接口地址。凭证缺失或错误时回到原 Router，不自动尝试其他 Jev 渠道。

应用 Jev 完全独立配置：只读取「设置 → Jev」保存的开关、所选渠道专用密钥和 Cloudflare Account ID，不读取回答模型密钥、系统环境变量或项目 `.env`，也不再读取 `JEV_ROUTER_ENABLED`。缺少专用密钥时不调用 Jev，继续使用本地规则和原 Router；删除专用密钥不会重新启用其他来源。Cloudflare Account ID 必须为此处保存的 32 位十六进制字符串。保存后对后续请求生效，主进程代码更新需重启应用或由开发监视器重启。下文独立实时诊断脚本仍可显式使用环境变量，仅用于测试，不属于应用配置来源。

新增渠道依据官方文档实现并用模拟响应验证，未执行新增渠道的真实账户调用：[TypeSafe](https://docs.typesafe.ai/api)、[Vercel](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe)、[Cloudflare](https://developers.cloudflare.com/ai/models/typesafe/jev/)。现有实时诊断脚本仍为 OpenRouter 专用，不代表其他渠道的联网验证。

日志 `EnglishAsk routing source` 的 `source` 可为 `rule`、`jev-assisted` 或 `original`；日志不包含密钥与问题内容。

本地规则优化前的真实验证：裸词 resilient 使用 Jev 直达（767ms）；say/tell 对比走 Jev 分类加当前模型补齐（2171ms）；缺失目标的问题因 Jev 不确定而回退原 Router，返回中文澄清（2110ms）。另一次完整 Ask 的路由使用 Jev（347ms），随后由 deepseek-v4-flash 成功生成含义、音标、用法和例句四个模块。以上为历史单次样本，不代表当前裸词路由耗时，也不是性能保证；测试未写入应用历史。

本地规则优化后，838 项源码测试通过（42 项 opt-in 跳过），生产构建与显式前端检查（补入 Node 测试类型）通过。测试覆盖有无 Jev 密钥、历史追问、取消和边界输入，并确认省去分类调用后回答生成仍执行。本轮未重新调用实时 API；此前主进程 Bundler 模式类型检查仍有既有错误。

实时验证命令：

```sh
JEV_HYBRID_LIVE=1 \
JEV_ROUTER_SETTINGS_PATH="$HOME/Library/Application Support/english-ask/settings.json" \
node --env-file=.env ./node_modules/vitest/vitest.mjs run src/main/hybrid-router-live.test.ts
```

本次证据位于 `/var/folders/gs/8tssgk8d2mx709j3bv6pwqph0000gp/T/englishask-hybrid-router-1790183728290.json`（临时文件可能被系统清理）。

## 接入前的独立对照试验

以下为接入实际路由前的历史对照结果。对照测试依然独立调用原 Router，不将模型结果写入 Asks 或 Notes，无新增依赖。

比较同一个问题和历史下的 `inputType`、`structureType`、`intent`、`responseMode`、每字段置信度以及完整请求耗时。现有 Router 还输出目标、模块和澄清文本，Jev 在本轮不做这些工作，因此耗时差不能直接等同于完整路由提速。原 Router 的置信度与 Jev 置信度不视为等价指标。

在 `.env` 配置 `OPENROUTER_API_KEY` 后运行（Node 支持 `--env-file`）：

```sh
node --env-file=.env ./node_modules/vitest/vitest.mjs run src/main/jev-router.test.ts

JEV_ROUTER_LIVE=1 \
JEV_ROUTER_SETTINGS_PATH="$HOME/Library/Application Support/english-ask/settings.json" \
node --env-file=.env ./node_modules/vitest/vitest.mjs run src/main/jev-router-live.test.ts
```

实时对照会调用 15 次 Jev 和 15 次当前配置的 Router（原 Router 保留自身重试策略），可能产生费用。仅发送代码中的合成样本，不读取用户历史。每组两条请求并行，各组顺序执行；Jev 最长 15 秒、原 Router 最长 45 秒。失败仍保存报告，不切换生产路由。

终端会显示临时 JSON 报告路径。报告包含分类、耗时、Jev 返回的费用以及相对于人工预设标签的差异；不包含密钥。报告中 `disagreements` 是模型之间的不一致，不是错误率。`*ExpectationFailures` 仅衡量已明确标注的字段，不能代表全面语义准确率。

接口依据：[OpenRouter Jev 接入文档](https://openrouter.ai/blog/insights/what-is-jev/)。

## 本轮结果

2026-09-24 完成 15 组真实调用。基线为应用当前配置的 `deepseek-v4-flash`；Jev 为 OpenRouter `typesafe/jev-1.13`。两边均未发生请求或响应校验失败。

| 指标 | 原 Router | Jev |
| --- | ---: | ---: |
| 请求耗时中位数 | 1,576 ms | 410 ms |
| 请求耗时范围 | 1,126–3,939 ms | 314–762 ms |
| 满足本轮已标注字段的样本数 | 15/15 | 15/15 |
| 四个分类字段与另一方完全一致 | 15/15 | 15/15 |
| 本轮 Jev 总费用（美元） | 未单独采集基线费用 | $0.0010542 |

样本覆盖：普通单词、裸词 hello、短语、搭配、句型、句子、段落、语法概念、比较、翻译、纠错、润色、带历史的发音追问、缺失上下文和明确结束学习的对话。

这是一轮小样本分类试验。没有证明复杂多意图、长历史、混合目标或对抗输入下的等价性；没有替换生产路由，也没有缩短应用当前回答时间。若后续尝试替代，还需解决目标提取、模块选择和澄清文本，以及验证回退策略。

原始结果：`/var/folders/gs/8tssgk8d2mx709j3bv6pwqph0000gp/T/englishask-jev-router-1790180226354.json`（系统临时目录，可能被清理）。

验证：17 项新增离线测试通过；完整 `vitest run src` 共 780 项通过、41 项按配置跳过；15 组实时对照测试通过；`npm run build` 通过。额外执行主进程显式类型检查时，现有 NodeNext 配置对无扩展名导入报错；临时以 Bundler 模式检查后仍有现有断言/类型错误，但新增 Jev 文件没有报错。前端显式检查原配置未包含 Node 类型，导致既有 UI 测试的 Node 导入报错。本次未修改这些无关配置。
