# 前端与 AI 应用面试题

共 71 题，点击题目可直接跳到[参考答案](answers/README.md)。题目只用于练习，不代表 Moose 实现了题中的方案；项目经历见[项目面试指南](project-interview-guide.md)。

题号在每个章节内独立编号，并沿用原题号，所以会有跳号；“流式处理·1”和“场景题·1”是两道不同的题。2026-10 按当前前端与 AI 应用的面试情况整理过一轮：删掉了前提不成立或几乎不考的题，重复的题合并后保留较小的原题号，新增的题（MCP、结构化输出、模型输出安全、审批界面、React 19 Actions）接在所在章节末尾编号。

建议先把项目讲熟，再练能从项目自然延伸出去的基础题，比如流式处理、React 状态与性能。其余题按目标岗位和简历经历挑选。这只是练习顺序建议，不代表各公司的出题频率。

## 一、TypeScript 与类型系统（4 题）

- **1.** [在定义 AI 接口返回的嵌套数据结构（如多轮对话、工具调用结果）时，如何用 TypeScript 的泛型与条件类型实现灵活的类型推导？](answers/01-typescript.md#1-在定义-ai-接口返回的嵌套数据结构如多轮对话工具调用结果时如何用-typescript-的泛型与条件类型实现灵活的类型推导)
- **2.** [当 AI 接口返回的字段可能因模型版本不同而动态变化时，如何设计类型守卫（type guard）与类型收缩策略？](answers/01-typescript.md#2-当-ai-接口返回的字段可能因模型版本不同而动态变化时如何设计类型守卫type-guard与类型收缩策略)
- **5.** [设计一个类型系统，用于描述 AI Agent 执行过程中的状态流转（如思考→执行→观察→完成），并实现类型安全的状态切换。](answers/01-typescript.md#5-设计一个类型系统用于描述-ai-agent-执行过程中的状态流转如思考执行观察完成并实现类型安全的状态切换)
- **7.** [如何用 TypeScript 声明一个支持流式 Chunk 数据与错误处理的泛型接口，并兼容 SSE、WebSocket 等多种传输方式？](answers/01-typescript.md#7-如何用-typescript-声明一个支持流式-chunk-数据与错误处理的泛型接口并兼容-ssewebsocket-等多种传输方式)

## 二、流式处理与实时通信（5 题）

- **1.** [请设计一个 SSE 客户端：能断线重连、消息去重，并按事件类型识别“生成完成”和“出错”。](answers/02-streaming.md#1-请设计一个-sse-客户端能断线重连消息去重并按事件类型识别生成完成和出错)
- **2.** [如何在前端实现一个“流式 Markdown 解析器”，在 AI 逐字输出过程中实时渲染标题、列表、代码块，并避免标签截断？](answers/02-streaming.md#2-如何在前端实现一个流式-markdown-解析器在-ai-逐字输出过程中实时渲染标题列表代码块并避免标签截断)
- **3.** [当 AI 流式返回的数据包含多个独立片段（如文本、代码、表格）时，如何设计 Chunk 合并算法以保证片段完整性？](answers/02-streaming.md#3-当-ai-流式返回的数据包含多个独立片段如文本代码表格时如何设计-chunk-合并算法以保证片段完整性)
- **5.** [在 React 18+中，如何用 useTransition 与 useDeferredValue 优化 AI 流式输出的渲染性能，避免主线程阻塞？](answers/02-streaming.md#5-在-react-18中如何用-usetransition-与-usedeferredvalue-优化-ai-流式输出的渲染性能避免主线程阻塞)
- **9.** [模型按 JSON Schema 返回结构化输出时，前端怎样在流式过程中边收边解析、边展示？](answers/02-streaming.md#9-模型按-json-schema-返回结构化输出时前端怎样在流式过程中边收边解析边展示)

## 三、前端状态管理与数据流（4 题）

- **1.** [在大型 AI 应用中，如何用 Zustand 或 Redux Toolkit 管理多轮对话、生成任务、用户配置等复杂状态？](answers/03-state-management.md#1-在大型-ai-应用中如何用-zustand-或-redux-toolkit-管理多轮对话生成任务用户配置等复杂状态)
- **2.** [设计一个“状态快照”系统，支持将 AI 对话的完整状态（包括流式中间结果）序列化保存与恢复。](answers/03-state-management.md#2-设计一个状态快照系统支持将-ai-对话的完整状态包括流式中间结果序列化保存与恢复)
- **5.** [用户发送 AI 请求后，怎样立即给出反馈，同时避免把尚未生成的内容当成结果？](answers/03-state-management.md#5-用户发送-ai-请求后怎样立即给出反馈同时避免把尚未生成的内容当成结果)
- **6.** [React 19 的 Actions、useActionState 和 useOptimistic 解决什么问题？在 AI 对话里怎么用？](answers/03-state-management.md#6-react-19-的-actionsuseactionstate-和-useoptimistic-解决什么问题在-ai-对话里怎么用)

## 四、性能优化与渲染（3 题）

- **1.** [对话历史达到万条时，怎样做搜索与过滤，并验证实际延迟？](answers/04-performance.md#1-对话历史达到万条时怎样做搜索与过滤并验证实际延迟)
- **2.** [超长对话和超长 AI 回答怎样做到滚动流畅、定位准确？虚拟列表、按需渲染和分页各解决什么问题？](answers/04-performance.md#2-超长对话和超长-ai-回答怎样做到滚动流畅定位准确虚拟列表按需渲染和分页各解决什么问题)
- **9.** [有了 React Compiler，还需要手写 React.memo、useMemo、useCallback 吗？消息列表怎样避免无关重渲染？](answers/04-performance.md#9-有了-react-compiler还需要手写-reactmemousememousecallback-吗消息列表怎样避免无关重渲染)

## 五、前端 AI 架构设计（2 题）

- **2.** [如何用 Monorepo 管理 AI 前端、Node.js 中间层、共享类型定义、工具脚本的统一代码库？](answers/05-architecture.md#2-如何用-monorepo-管理-ai-前端nodejs-中间层共享类型定义工具脚本的统一代码库)
- **9.** [前端能否直接调用多个 AI 服务商 API？密钥、权限和计费应放在哪里处理？](answers/05-architecture.md#9-前端能否直接调用多个-ai-服务商-api密钥权限和计费应放在哪里处理)

## 六、AI 特性与前端工程实践（5 题）

- **1.** [在前端实现一个 Agent 循环时，如何管理工具调用的异步执行、超时处理与结果合并？](answers/06-ai-features.md#1-在前端实现一个-agent-循环时如何管理工具调用的异步执行超时处理与结果合并)
- **3.** [在 AI 产品中，前端可以通过哪些技术手段（如缓存、压缩、懒加载）帮助降低 Token 成本？](answers/06-ai-features.md#3-在-ai-产品中前端可以通过哪些技术手段如缓存压缩懒加载帮助降低-token-成本)
- **9.** [在 AI 多轮对话中，如何设计上下文窗口的管理策略（如滑动窗口、关键信息提取、自动摘要）？](answers/06-ai-features.md#9-在-ai-多轮对话中如何设计上下文窗口的管理策略如滑动窗口关键信息提取自动摘要)
- **10.** [模型输出的 Markdown 和链接怎样安全渲染？前端能防住提示词注入吗？](answers/06-ai-features.md#10-模型输出的-markdown-和链接怎样安全渲染前端能防住提示词注入吗)
- **11.** [Agent 要执行危险操作（改文件、跑命令、联网）前，审批界面该怎么设计？](answers/06-ai-features.md#11-agent-要执行危险操作改文件跑命令联网前审批界面该怎么设计)

## 七、AI 工程化与前端工具链（6 题）

- **2.** [现在怎样搭一套前端代码规范和提交检查？ESLint、Prettier 之外还有什么选择？](answers/07-engineering-toolchain.md#2-现在怎样搭一套前端代码规范和提交检查eslintprettier-之外还有什么选择)
- **4.** [设计一个 AI 前端项目的 CI/CD 流水线，包括代码检查、单元测试、E2E 测试、构建优化、自动部署。](answers/07-engineering-toolchain.md#4-设计一个-ai-前端项目的-cicd-流水线包括代码检查单元测试e2e-测试构建优化自动部署)
- **6.** [AI 应用怎样监控页面体验（LCP、INP、CLS）和模型响应（首字时间、生成耗时）？](answers/07-engineering-toolchain.md#6-ai-应用怎样监控页面体验lcpinpcls和模型响应首字时间生成耗时)
- **8.** [设计一个 AI 前端日志系统，结构化记录用户操作、AI 请求、响应时间、错误信息，便于回溯分析。](answers/07-engineering-toolchain.md#8-设计一个-ai-前端日志系统结构化记录用户操作ai-请求响应时间错误信息便于回溯分析)
- **9.** [用 Vite 做构建优化：代码分割、Tree Shaking、预加载和长期缓存怎么做？还需要会 Webpack 吗？](answers/07-engineering-toolchain.md#9-用-vite-做构建优化代码分割tree-shaking预加载和长期缓存怎么做还需要会-webpack-吗)
- **10.** [请设计一个 AI 前端依赖管理策略，定期更新模型 SDK、工具库，并评估兼容性与性能影响。](answers/07-engineering-toolchain.md#10-请设计一个-ai-前端依赖管理策略定期更新模型-sdk工具库并评估兼容性与性能影响)

## 八、大模型前端集成（3 题）

- **1.** [大模型的工具调用（tool calling）在应用里怎么落地？哪些步骤必须放在后端？](answers/08-llm-integration.md#1-大模型的工具调用tool-calling在应用里怎么落地哪些步骤必须放在后端)
- **5.** [如何用 WebSocket 实现双向流式通信，支持 AI 模型主动推送进度更新、中断信号、工具调用请求？](answers/08-llm-integration.md#5-如何用-websocket-实现双向流式通信支持-ai-模型主动推送进度更新中断信号工具调用请求)
- **7.** [MCP 是什么？和直接写工具调用有什么区别，前端/全栈要关心什么？](answers/08-llm-integration.md#7-mcp-是什么和直接写工具调用有什么区别前端全栈要关心什么)

## 场景题（39 题）

按主题分成四组，题号沿用原题号。

### 页面交互、浏览器 API 与 React（16 题）

- **1.** [如何判断用户设备？为什么不再推荐解析 User-Agent？](answers/09-scenarios-ui-react.md#1-如何判断用户设备为什么不再推荐解析-user-agent)
- **4.** [滚动跟随导航（电梯导航）该如何实现](answers/09-scenarios-ui-react.md#4-滚动跟随导航电梯导航该如何实现)
- **8.** [移动端如何实现下拉滚动加载（顶部加载）](answers/09-scenarios-ui-react.md#8-移动端如何实现下拉滚动加载顶部加载)
- **9.** [判断页签是否为活跃状态](answers/09-scenarios-ui-react.md#9-判断页签是否为活跃状态)
- **12.** [页面关闭时执行方法，该如何做](answers/09-scenarios-ui-react.md#12-页面关闭时执行方法该如何做)
- **14.** [长文本溢出，展开/收起如何实现](answers/09-scenarios-ui-react.md#14-长文本溢出展开收起如何实现)
- **15.** [如何实现鼠标拖拽](answers/09-scenarios-ui-react.md#15-如何实现鼠标拖拽)
- **18.** [ResizeObserver 有什么用？要实时统计浏览器窗口大小该怎么做？](answers/09-scenarios-ui-react.md#18-resizeobserver-有什么用要实时统计浏览器窗口大小该怎么做)
- **27.** [如何实现预览 PDF 文件](answers/09-scenarios-ui-react.md#27-如何实现预览-pdf-文件)
- **28.** [如何在划词选中的文本上添加右键菜单？富文本编辑器里的划词又是怎么做的？](answers/09-scenarios-ui-react.md#28-如何在划词选中的文本上添加右键菜单富文本编辑器里的划词又是怎么做的)
- **36.** [前端如何实现折叠面板效果？](answers/09-scenarios-ui-react.md#36-前端如何实现折叠面板效果)
- **37.** [dom 里面，如何判定 a 元素是否是 b 元素的子元素](answers/09-scenarios-ui-react.md#37-dom-里面如何判定-a-元素是否是-b-元素的子元素)
- **41.** [flex:1 代表什么](answers/09-scenarios-ui-react.md#41-flex1-代表什么)
- **49.** [[React]循环渲染中为什么推荐不用 index 做 key](answers/09-scenarios-ui-react.md#49-react循环渲染中为什么推荐不用-index-做-key)
- **50.** [[React]如何避免使用 context 的时候，引起整个挂载节点树的重新渲染](answers/09-scenarios-ui-react.md#50-react如何避免使用-context-的时候引起整个挂载节点树的重新渲染)
- **60.** [站点一键换肤的实现方式有哪些？](answers/09-scenarios-ui-react.md#60-站点一键换肤的实现方式有哪些)

### 性能、监控与线上问题（6 题）

- **6.** [怎样用 PerformanceObserver 采集页面性能？长任务、INP 和 LoAF 分别说明什么？](answers/10-scenarios-performance-monitoring.md#6-怎样用-performanceobserver-采集页面性能长任务inp-和-loaf-分别说明什么)
- **16.** [怎样统计全站每个静态资源和接口请求的耗时？](answers/10-scenarios-performance-monitoring.md#16-怎样统计全站每个静态资源和接口请求的耗时)
- **22.** [如何还原用户操作流程](answers/10-scenarios-performance-monitoring.md#22-如何还原用户操作流程)
- **23.** [可有办法将请求的调用源码地址包括代码行数也上报上去？](answers/10-scenarios-performance-monitoring.md#23-可有办法将请求的调用源码地址包括代码行数也上报上去)
- **30.** [如何做好前端监控方案](answers/10-scenarios-performance-monitoring.md#30-如何做好前端监控方案)
- **31.** [如何标准化处理线上用户反馈的问题](answers/10-scenarios-performance-monitoring.md#31-如何标准化处理线上用户反馈的问题)

### 网络、请求、上传与登录（8 题）

- **10.** [大文件上传怎么做？切片大小怎么定，切片真的更快吗？](answers/11-scenarios-network-upload.md#10-大文件上传怎么做切片大小怎么定切片真的更快吗)
- **17.** [如何防止重复请求？页面要同时请求大量接口时怎么控制并发？](answers/11-scenarios-network-upload.md#17-如何防止重复请求页面要同时请求大量接口时怎么控制并发)
- **24.** [请求失败会弹出一个 toast,如何保证批量请求失败，只弹出一个 toast](answers/11-scenarios-network-upload.md#24-请求失败会弹出一个-toast如何保证批量请求失败只弹出一个-toast)
- **33.** [浏览器有同源策略，但是为何 cdn 请求资源的时候不会有跨域限制](answers/11-scenarios-network-upload.md#33-浏览器有同源策略但是为何-cdn-请求资源的时候不会有跨域限制)
- **34.** [Cookie 由哪些部分组成？能不能在不同域之间共享？](answers/11-scenarios-network-upload.md#34-cookie-由哪些部分组成能不能在不同域之间共享)
- **52.** [当 QPS 达到峰值时，该如何处理？](answers/11-scenarios-network-upload.md#52-当-qps-达到峰值时该如何处理)
- **64.** [扫码登录实现方式](answers/11-scenarios-network-upload.md#64-扫码登录实现方式)
- **65.** [DNS 协议了解多少](answers/11-scenarios-network-upload.md#65-dns-协议了解多少)

### Git、代码质量与发布（9 题）

- **2.** [如何把多次提交压缩成一次？如何移除一个指定的 commit？](answers/12-scenarios-engineering.md#2-如何把多次提交压缩成一次如何移除一个指定的-commit)
- **20.** [当项目报错，你想定位是哪个 commit 引入的错误的时，该怎么做](answers/12-scenarios-engineering.md#20-当项目报错你想定位是哪个-commit-引入的错误的时该怎么做)
- **25.** [如何减少项目里面 if-else](answers/12-scenarios-engineering.md#25-如何减少项目里面-if-else)
- **42.** [一般是怎么做代码重构的](answers/12-scenarios-engineering.md#42-一般是怎么做代码重构的)
- **43.** [如何清理源码里面没有被引用的代码，主要是 JS、TS、CSS 代码](answers/12-scenarios-engineering.md#43-如何清理源码里面没有被引用的代码主要是-jstscss-代码)
- **44.** [前端应用如何做国际化？](answers/12-scenarios-engineering.md#44-前端应用如何做国际化)
- **45.** [应用如何做应用灰度发布](answers/12-scenarios-engineering.md#45-应用如何做应用灰度发布)
- **66.** [函数式编程了解多少？](answers/12-scenarios-engineering.md#66-函数式编程了解多少)
- **68.** [什么是领域模型](answers/12-scenarios-engineering.md#68-什么是领域模型)
