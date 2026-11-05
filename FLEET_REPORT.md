# 认证修复交付记录

结论：代码修复已提交 `18d52f144e44a638901652d02d70425e527d5add`；仅完成隔离环境部署，生产验收未完成。
证据：`artifacts/auth-{typecheck,vitest,python,build,playwright}.log`；类型检查、构建通过，Vitest 602 项、Python sidecar 33 项、Chromium Playwright 2 项通过。
证据：`artifacts/auth-deployment.json`、`artifacts/auth-sidecar-access.log`；本地真实 sidecar 40 次认证轮询全部 200，认证后 401 为 0；3 次主动缺认证负例返回 401，属于预期。
证据：新增日志输出 `workbench_auth_required`、路径、peer、缺失头原因，不记录密钥、令牌或用户身份。

```mermaid
flowchart TD
    A[用户现场证据：health 200 与三个 API 连续 401]
    A --> B[源码确认：所有 Workbench API 需要代理密钥与允许的 Remote-User]
    B --> C[静态资源公开，页面加载不能证明 API 身份有效]
    B --> D[浏览器 fetch 已使用同源 Cookie]
    D --> E[Caddy 必须在 Authelia 认证后路由 API]
    E --> F[新增可选 Authelia snippet 清除客户端身份头]
    F --> G[forward_auth copy_headers Remote-User]
    G --> H[显式传递已认证 Remote-User 与代理密钥]
    H --> I[sidecar allowlist 验证]
    B --> J[旧代码没有内部状态专用认证]
    J --> K[新增独立内部状态令牌]
    K --> L[只允许 GET 或 HEAD 三个状态路径]
    L --> M[不授予写入或其他 API 权限]
    B --> N[IP 本身不能证明身份]
    N --> O[127.0.0.1 可能是内部调用或本机代理]
    N --> P[192.168.32.1 可能是桥接代理地址]
    N --> Q[远程设备应通过同一认证代理]
    O --> R[未验证：现场调用者配置与代理日志关联]
    P --> R
    Q --> R
```

结论：公开状态端点明确为 `/health`、`/healthz`；`/versions`、`/versions/update-status`、`/codex-runtime/status` 保持私有。内部调用使用 `HERMES_WORKBENCH_INTERNAL_STATUS_TOKEN` 和 `X-Workbench-Status-Token`，代理剥离浏览器传入的机器令牌。
风险：必须在实际代理启用认证 snippet 或等效身份映射，并配置真实内部调用者；本次只修改仓库模板，没有改动生产代理或用户其他工作区。

```mermaid
sequenceDiagram
    participant Browser as 浏览器后台轮询
    participant Guard as Workbench fetch 守卫
    participant Proxy as 认证代理
    participant Sidecar as Sidecar
    participant User as 用户
    Browser->>Guard: Workbench API 请求
    Guard->>Proxy: 同源凭证与禁止自动跟随重定向
    alt 身份有效
        Proxy->>Sidecar: Remote-User 与代理密钥
        Sidecar-->>Browser: API 响应
    else 会话过期或身份头缺失
        Proxy-->>Guard: 401 或登录重定向
        Guard-->>Browser: auth_required 错误
        Guard->>User: 单一登录失效提示
        loop 后续后台轮询
            Browser->>Guard: 请求
            Guard-->>Browser: 本地拒绝，网络暂停
        end
        User->>Proxy: 手动打开登录页面
        User->>Guard: 手动重试
        Guard->>Proxy: capabilities 认证探测
        alt 探测成功
            Proxy-->>Guard: 200
            Guard->>Browser: 解除暂停，后续轮询恢复
        else 探测失败
            Proxy-->>Guard: 401 或重定向
            Guard->>User: 保留原提示及重试按钮
        end
    end
    Note over Browser,Sidecar: 不清除本地会话，不自动导航，不自动重放失败写入
    Note over Proxy,Sidecar: API 401 含 code=auth_required 与中文 detail，禁止缓存
    Note over Browser,Sidecar: 导航请求返回 HTML 与手动登录入口，避免整页裸 JSON
```

证据：执行 `pnpm typecheck`、`pnpm test`、`env -u CODEX_APP_SERVER_ENDPOINT -u CODEX_HOME .venv/bin/python -m pytest -q tests/test_sidecar_app.py`、`XDG_CONFIG_HOME=$PWD/.isolated-config pnpm build`、`PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers pnpm exec playwright test --config tests/auth-playwright.config.ts`。
证据：执行 `.venv/bin/python scripts/auth-sidecar-smoke.py`，于 2026-11-05 UTC 启动隔离本地 uvicorn，探测完成后终止；状态文件位于当前工作目录 `test-results/auth-sidecar`，未发布到宿主实例。
风险：Python 测试使用隔离 Python 3.12 环境及最小依赖，未使用部署要求的 Python 3.13 完整锁定依赖；存在 pytest/Starlette 弃用提示。

```mermaid
flowchart LR
    A[回归验证] --> B[缺 Remote-User 与代理密钥：通过]
    A --> C[过期 Cookie：通过]
    A --> D[三个私有状态端点认证门禁：通过]
    A --> E[机器令牌越权与 IP 绕过：拒绝]
    A --> F[公开 health 和 healthz：通过]
    A --> G[HTML 导航与 JSON API：通过]
    A --> H[Playwright 401 和 302：通过]
    H --> I[后台网络停止增长]
    H --> J[失败手动重试保留单一提示]
    H --> K[成功重试恢复轮询]
    H --> L[导航为零且本地会话保留]
    A --> M[真实本地 sidecar 部署]
    M --> N[40 次认证请求无 401 循环]
    A --> O[生产部署：未完成]
    O --> P[Docker daemon 无法连接]
    O --> Q[现场 Caddy 与 Authelia 配置：未验证]
    O --> R[现场内部调用者令牌配置：未验证]
    O --> S[现场设备与生产访问日志：未验证]
    A --> T[完整 Hermes 与 Authelia 浏览器链路：未验证]
    A --> U[Codex runtime 实际服务状态：未验证]
    A --> V[完整 Python 测试集：未运行]
```

未验证项：生产 `hermes-workbench-zzl` 部署和连续日志观察未完成；`artifacts/auth-production-access.log` 记录 Docker daemon 无法连接。不能据此声称现场 401 来源已精确定位或生产循环已消失。
未验证项：Playwright 使用真实 Chromium 与受控 API 响应，验证守卫行为；没有运行完整 Hermes/Caddy/Authelia 登录流程。本地 sidecar 未连接 Codex app-server，运行时状态端点只验证认证门禁，未验证实际服务可用性。
