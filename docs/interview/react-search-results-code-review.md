# React 搜索组件代码审查题

## 题目

面试官给出下面这段 AI 生成的搜索组件：请找出问题，说明用户可能看到什么现象，并给出修正方案。

```jsx
function SearchResults({ query }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/search?q=${query}`)
      .then(res => res.json())
      .then(data => {
        setResults(data);
        setLoading(false);
      });
  }, [query]);

  return (
    <div>
      {loading ? <Spinner /> : results.map(r => (
        <div key={r.id}>{r.title}</div>
      ))}
    </div>
  );
}
```

## 可以这样答

**最关键的是请求竞态。** 用户输入 `a` 后又输入 `ab`，两个请求同时在路上；如果 `a` 的请求最后返回，它会覆盖 `ab` 的结果。旧请求还可能先把 `loading` 设为 `false`，导致新请求仍在进行时页面却停止显示加载状态。`query` 改变或组件卸载时，应在 effect 清理函数中取消旧请求，并阻止旧请求更新状态。

**失败路径没有处理。** 网络失败或 JSON 解析失败时，第二个 `.then` 不执行，加载状态会一直保持为 `true`。`fetch` 收到 HTTP 4xx/5xx 也不会因此自动 reject，必须检查 `res.ok`。需要单独的错误状态，并让成功、失败都正确结束加载。

**请求参数没有编码。** 例如 `query` 为 `a&b` 时，直接拼 URL 会把 `&b` 解释成另一个参数。可以用 `URLSearchParams` 构造查询串。

**交互与数据边界也要明确。** 输入每变一次就请求一次，实际搜索框通常按需求做防抖；空查询是否发请求由产品规则决定。接口返回值也不应直接假设为数组，否则异常数据会让 `results.map` 报错。加载期间隐藏旧结果是否合适，也取决于设计：很多搜索页会保留旧结果并在旁边显示加载提示。

`key={r.id}` 在 ID 稳定且唯一时是合理的，不能仅因为它是 AI 生成代码就判为问题。

## 一种修正示例

下面选择“开始新查询时清空旧结果”的交互，避免把旧关键词的结果当成新结果。示例假定 API 返回唯一字符串 ID 与标题；逐项验证后才渲染。取消处理保证旧请求的成功、失败和 finally 都不能更新当前查询。防抖与空查询规则由父组件决定；防抖本身不能解决响应乱序。

```jsx
import { useEffect, useState } from 'react';

function SearchResults({ query }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function search() {
      setLoading(true);
      setError(null);
      setResults([]);

      try {
        const params = new URLSearchParams({ q: query });
        const res = await fetch(`/api/search?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);

        const data = await res.json();
        if (!Array.isArray(data) || !data.every(item =>
          item !== null && typeof item === 'object' &&
          typeof item.id === 'string' && typeof item.title === 'string'
        ) || new Set(data.map(item => item.id)).size !== data.length) {
          throw new Error('搜索结果格式错误');
        }
        if (!controller.signal.aborted) setResults(data);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : '搜索失败');
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    search();
    return () => controller.abort();
  }, [query]);

  return (
    <div aria-busy={loading}>
      {loading && <p role="status">搜索中…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && results.length === 0 && <p>没有搜索结果</p>}
      {!error && results.map(r => <div key={r.id}>{r.title}</div>)}
    </div>
  );
}
```

**追问：** 只调用 `AbortController.abort()` 就够了吗？客户端取消请求可以减少无用工作、避免旧请求更新当前组件；但服务端可能已开始处理，因此不能把取消当成服务端一定停止执行。若使用不支持取消的请求方式，可用 effect 内的失效标记或请求序号忽略旧响应。

## 怎样证明修好了

不要只测一次成功请求。用可控制返回顺序的请求替身覆盖以下场景：

| 操作顺序 | 应看到什么 |
| --- | --- |
| 搜 `a`，再搜 `ab`；先返回 `ab`，再返回 `a` | 只展示 `ab` 的结果，旧请求不能改 loading 或 error |
| 请求返回 500、非法 JSON，或数组中混入 `null` | 结束加载并显示错误，不在渲染阶段崩溃 |
| 搜 `a&b` | 服务端收到一个值为 `a&b` 的查询参数 |
| 查询过程中卸载，再挂载组件 | 旧请求不能更新新组件，也没有遗留监听 |
| 请求返回空数组 | 加载结束后显示“没有搜索结果” |

在 Moose 中可继续追问：桌面 IPC 不提供和 fetch 一样的取消信号怎么办？搜索弹窗用请求代次忽略过期结果。用户点中尚未加载的历史消息时，则调用定位接口读取上下文，不能只对当前 DOM 执行滚动。见[项目搜索链路](reference/07-search-notice-preview.md#搜索命中后怎样找到很久以前的消息)。
