# portal-runtime

主框架和子框架共用的运行时能力包。它后续应该放在独立 git 仓库里，由主框架、子框架分别依赖。

当前本地模拟包名是 `@local/portal-runtime`。公共包 git 地址为：

```txt
https://github.com/Cifer0818/commonComponents.git
```

后续接入私有 npm 时，可以改成公司作用域包名，例如 `@company/portal-runtime`。

## 提供能力

- `auth`: mock token 生成、解析、过期判断、无感刷新辅助。
- `entry-url`: 主系统拼接入口 token，子系统消费并清理 URL token。
- `request`: 统一请求客户端工厂，业务工程传入自己的 axios transport。
- `styles`: 公共 CSS token 和基础样式。

## 当前本地依赖方式

现在还没有公共 git 源，所以当前联调保留本地路径依赖：

```json
{
  "dependencies": {
    "@local/portal-runtime": "file:../packages/portal-runtime"
  }
}
```

这种方式只适合当前同一目录下的模拟联调，不作为不同团队的默认协作方式。

## 团队协作方式

公共包提交到 `commonComponents.git` 并打 tag 后，主框架和子框架都通过 git tag 依赖公共包：

```json
{
  "dependencies": {
    "@local/portal-runtime": "git+https://github.com/Cifer0818/commonComponents.git#v1.0.0"
  }
}
```

子框架团队只需要拉自己的子框架仓库。执行 `pnpm install` 时，包管理器会按依赖地址拉取 `commonComponents.git`。

在公共包还没有推送并打 tag 前，主框架和子框架继续使用本地 `file:` 依赖测试。

## 私有 npm 方式

有私有 npm 仓库后，建议发布成版本化包：

```bash
pnpm add @company/portal-runtime
```

对应 `.npmrc` 示例：

```ini
@company:registry=https://npm.company.com/
```

发布前需要把 `package.json` 的 `name` 改成公司作用域包名，并移除 `private: true`。

## 使用示例

主系统打开子系统：

```js
import { appendTokenToUrl } from '@local/portal-runtime'

const childUrl = appendTokenToUrl('http://localhost:5174/prescription', token)
```

子系统消费入口 token：

```js
import { consumeTokenFromUrl, parseToken } from '@local/portal-runtime'

const { token, cleanUrl } = consumeTokenFromUrl(window.location.href)
const session = parseToken(token)
```

统一请求：

```js
import { createRequestClient } from '@local/portal-runtime'

const { http } = createRequestClient({
  getToken: () => sessionStorage.getItem('token'),
  transport: (config) => axios(config),
})
```

公共样式：

```js
import '@local/portal-runtime/styles'
```

## 仓库职责

- `portal-main`: 主框架仓库，只负责登录、权限菜单、入口 URL 拼接。
- `medication-quality-control`: 子系统仓库，只负责自身页面、路由、入口 token 解析、本地 session。
- `portal-runtime`: 公共包仓库，只放跨系统复用能力，不依赖主框架或子框架源码。

当前仓库对应关系：

- 主框架: `https://github.com/Cifer0818/admin-main.git`
- 子框架: `https://github.com/Cifer0818/Subsystem.git`
- 公共包: `https://github.com/Cifer0818/commonComponents.git`
