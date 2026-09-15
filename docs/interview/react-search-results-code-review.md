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

下面示例在请求变化时取消旧请求，分别处理 HTTP 错误、数据结构错误和加载状态。防抖与空查询规则可在父组件或搜索输入层按需求加入。

```jsx
function SearchResults({ query }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function search() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({ q: query });
        const res = await fetch(`/api/search?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`搜索失败：HTTP ${res.status}`);

        const data = await res.json();
        if (!Array.isArray(data)) throw new Error('搜索结果格式错误');
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
    <div>
      {loading && <Spinner />}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && results.length === 0 && <p>没有搜索结果</p>}
      {!error && results.map(r => <div key={r.id}>{r.title}</div>)}
    </div>
  );
}
```

**追问：** 只调用 `AbortController.abort()` 就够了吗？客户端取消请求可以减少无用工作、避免旧请求更新当前组件；但服务端可能已开始处理，因此不能把取消当成服务端一定停止执行。若使用不支持取消的请求方式，可用 effect 内的失效标记或请求序号忽略旧响应。
