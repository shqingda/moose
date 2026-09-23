import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

const installCommand = 'curl -fsSL https://moose.shqingda.workers.dev/install.sh | sh\nmoose';

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 100 100" role="img" aria-label="Moose">
      <rect width="100" height="100" rx="24" fill="#173f31" />
      <path
        fill="#d5ad66"
        d="M53 48C43 45 28 45 20 37c-7-7-8-17-6-24 1-1 3 0 3 3l4 10 3 1-1-17c0-3 3-3 4 0l4 16 4 1 2-19c1-3 4-2 4 1v18l4-2 6-12c2-3 5-1 4 2l-4 18c-3 6-4 7 3 10z"
      />
      <path
        fill="#f5f2e6"
        d="M22 87c7-11 13-21 17-33l1-6c-7 0-13-5-13-11 7-1 13 2 17 7 6-4 12-4 17 0 4 3 5 9 11 12l11 5c4 2 6 6 5 11 0 4-3 7-8 7l-16-1c-4 0-6-2-7-5-3 7-4 12-4 17H22z"
      />
      <circle cx="61.5" cy="54" r="1.5" fill="#173f31" />
    </svg>
  );
}

function Home() {
  const [copyLabel, setCopyLabel] = useState('复制命令');

  useEffect(() => {
    if (copyLabel === '复制命令') return;
    const timer = window.setTimeout(() => setCopyLabel('复制命令'), 3000);
    return () => window.clearTimeout(timer);
  }, [copyLabel]);

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopyLabel('已复制');
    } catch {
      setCopyLabel('请手动复制');
    }
  }

  return (
    <>
      <header className="shell">
        <nav aria-label="主导航">
          <a className="brand" href="#top" aria-label="Moose 首页">
            <Mark />
            Moose
          </a>
          <div className="nav-links">
            <a href="#why">产品</a>
            <a href="#install">安装</a>
            <a href="https://github.com/shqingda/moose">GitHub</a>
            <a className="nav-button" href="#install">
              获取 Moose
            </a>
          </div>
        </nav>
      </header>

      <main id="top">
        <section className="hero shell">
          <div>
            <h1>面向 AI 编程代理的本地工作台</h1>
            <p className="lede">
              Moose 将 Codex、Pi、OpenCode
              等本地代理集中到一个界面，统一管理项目、任务、终端和代码变更。
            </p>
            <div className="actions">
              <a className="button" href="https://github.com/shqingda/moose/releases/latest">
                下载 macOS 客户端
              </a>
              <a className="button secondary" href="#install">
                安装 Web UI
              </a>
            </div>
            <p className="compatibility">支持 macOS Apple Silicon · 代理 CLI 需单独安装</p>
          </div>

          <div className="app-frame" aria-label="Moose 应用界面示意图">
            <div className="window-bar">
              <i />
              <i />
              <i />
            </div>
            <div className="app-body">
              <aside className="sidebar">
                <div className="side-brand">Moose</div>
                <div className="side-item active">新任务</div>
                <div className="side-item">moose</div>
                <div className="side-item">website</div>
                <div className="local">本地工作区</div>
              </aside>
              <div className="conversation">
                <div className="conversation-title">moose / 网站首页</div>
                <div className="prompt">更新产品首页：调整中文排版，并检查移动端布局。</div>
                <div className="agent">
                  <div className="agent-name">Codex 正在工作</div>
                  <p>已检查现有发布目录，接下来修改页面并验证下载链接。</p>
                  <div className="tool-row">
                    <span>读取 distribution/</span>
                    <span>完成</span>
                  </div>
                  <div className="tool-row">
                    <span>修改 index.html</span>
                    <span>完成</span>
                  </div>
                </div>
                <div className="composer">发送跟进消息…</div>
              </div>
            </div>
          </div>
        </section>

        <section className="statement shell" id="why">
          <h2>从任务执行到代码提交，开发过程集中呈现，工作数据保留在本机。</h2>
          <div className="principles">
            <article className="principle">
              <h3>统一连接多种代理</h3>
              <p>继续使用现有的代理 CLI、模型与账户，无需迁移原有配置。</p>
            </article>
            <article className="principle">
              <h3>集中管理持续任务</h3>
              <p>任务可在后台继续运行，随时查看输出、处理审批或补充后续要求。</p>
            </article>
            <article className="principle">
              <h3>本地保存工作数据</h3>
              <p>项目、会话记录和终端状态保存在本机；Moose 不提供云端托管，也不接管模型账户。</p>
            </article>
          </div>
        </section>

        <section className="install" id="install">
          <div className="install-grid shell">
            <div>
              <h2>下载与安装</h2>
              <p className="install-copy">
                macOS 桌面客户端适合完整的本地工作流程；Web UI 安装在本机，通过浏览器访问。Web
                安装包包含运行环境，<strong>无需单独安装 Node.js</strong>。
              </p>
            </div>
            <div>
              <div className="installer">
                <div className="installer-tabs">
                  <span>Web UI · macOS Apple Silicon</span>
                  <button className="copy-button" type="button" onClick={copyInstallCommand}>
                    {copyLabel}
                  </button>
                </div>
                <pre>
                  <code>
                    <span className="dollar">$</span> curl -fsSL
                    https://moose.shqingda.workers.dev/install.sh | sh{'\n'}
                    <span className="dollar">$</span> moose
                  </code>
                </pre>
              </div>
              <div className="download-row">
                <div>
                  <strong>Moose for macOS</strong>
                  <small>Apple Silicon · DMG</small>
                </div>
                <a href="https://github.com/shqingda/moose/releases/latest">下载客户端</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="shell">
        <div>© 2026 Moose</div>
        <div>
          <a href="https://github.com/shqingda/moose">GitHub</a>
          <a href="https://github.com/shqingda/moose/blob/main/docs/usage.md">使用指南</a>
        </div>
      </footer>
    </>
  );
}
