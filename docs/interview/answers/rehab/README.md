# 复健教程

答题稿在 [answers](../README.md)。面试时对着那一份说。这里按同样的章节把知识再讲一遍，方便你合上文件，用自己的话讲出来。答题稿一行不改。

先看它是什么、为什么要这么做，再看常见写法，最后对上 Moose 0.23.3 里实际有的行为。标了 **补充知识** 的段落，答题稿没有展开，只是垫个底，不要说成 Moose 的实现。标了 **Moose** 的段落只重复已经核对过的事实，不额外加项目行为。

## 怎么读

1. 先读教程，合上文件，用自己的话把文末那几句讲一遍。
2. 再打开对应答案，看「一句话回答」能不能说出口。说不出，回到教程那一节，先别背答案。
3. 题号沿用原题，所以会跳号。一章太长就拆成上下篇。下篇文末把整章收一下。

## 阅读顺序

建议按编号读。前一章的词，后面会接着用。

```
类型怎么描述会变的数据
  → 字节流怎么变成可靠事件
  → 事件怎么变成不会互相打架的状态
  → 状态变了，页面为什么会卡，卡在哪一层
  → 代码和密钥该放在仓库的哪一层
  → Agent 循环、Token、不可信输出、审批
  → 怎样把坏代码拦在发布之前
  → 模型说「调用工具」之后，应用要补上的步骤
  → 页面交互、浏览器 API、React 列表
  → 线上慢和线上错怎么看见
  → 请求、上传、Cookie、登录
  → 改历史、改结构、灰度与业务词汇
```

| 教程 | 对应答案 | 覆盖的原题号 |
| --- | --- | --- |
| [一、类型](01-typescript.md) | [01](../01-typescript.md) | 1、2、5、7 |
| [二、流式 · 上](02-streaming-1.md) | [02](../02-streaming.md) | 1、3 |
| [二、流式 · 下](02-streaming-2.md) | [02](../02-streaming.md) | 2、5、9 |
| [三、状态](03-state-management.md) | [03](../03-state-management.md) | 1、2、5、6 |
| [四、性能](04-performance.md) | [04](../04-performance.md) | 1、2、9 |
| [五、架构边界](05-architecture.md) | [05](../05-architecture.md) | 2、9 |
| [六、Agent 与成本 · 上](06-ai-features-1.md) | [06](../06-ai-features.md) | 1、3、9 |
| [六、输出安全与审批 · 下](06-ai-features-2.md) | [06](../06-ai-features.md) | 10、11 |
| [七、拦住坏代码 · 上](07-toolchain-1.md) | [07](../07-engineering-toolchain.md) | 2、4、10 |
| [七、看见慢、拆开包 · 下](07-toolchain-2.md) | [07](../07-engineering-toolchain.md) | 6、8、9 |
| [八、模型接入](08-llm-integration.md) | [08](../08-llm-integration.md) | 1、5、7 |
| [九、页面与浏览器 · 上](09-ui-react-1.md) | [09](../09-scenarios-ui-react.md) | 1、4、8、9、12、14、15、18 |
| [九、内容、布局与 React · 下](09-ui-react-2.md) | [09](../09-scenarios-ui-react.md) | 27、28、36、37、41、49、50、60 |
| [十、监控](10-monitoring.md) | [10](../10-scenarios-performance-monitoring.md) | 6、16、22、23、30、31 |
| [十一、请求怎么发 · 上](11-network-1.md) | [11](../11-scenarios-network-upload.md) | 10、17、24、52 |
| [十一、浏览器怎么认你 · 下](11-network-2.md) | [11](../11-scenarios-network-upload.md) | 33、34、64、65 |
| [十二、改代码的手感 · 上](12-engineering-1.md) | [12](../12-scenarios-engineering.md) | 2、20、25、42、43 |
| [十二、发布与业务词汇 · 下](12-engineering-2.md) | [12](../12-scenarios-engineering.md) | 44、45、66、68 |
