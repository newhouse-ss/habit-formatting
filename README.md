# 作战日志

日常习惯打卡 + 定投记录。Cloudflare Workers + D1，无需本地 Node.js/wrangler，靠 GitHub 推送触发部署。日程规划改用 Notion，这里不做同步。

## 部署步骤（全部在网页操作，不需要装任何本地工具）

1. **建 D1 数据库**：Cloudflare 控制台 → Workers & Pages → D1 → 创建数据库，命名 `plan-grind-db`。创建后打开它的 Console 标签，把 `schema.sql` 里的内容粘进去执行一次，把表建好。
2. **把数据库 ID 填进代码**：复制这个数据库的 Database ID，替换 `wrangler.toml` 里的 `REPLACE_WITH_YOUR_D1_DATABASE_ID`，提交并推送到 GitHub。
3. **建 Worker 并连 GitHub**：Workers & Pages → 创建 → 从 Git 导入，选这个仓库。构建产物就是仓库根目录（`wrangler.toml` 会被自动识别）。
4. **绑定 D1**：Worker 的 Settings → Bindings，添加 D1 binding，变量名 `DB`，选中第 1 步建的数据库（如果 `wrangler.toml` 里已经填了正确的 database_id，这一步可能已经自动生效，检查一下就行）。
5. **部署**：推送到 GitHub 主分支后 Cloudflare 会自动构建部署。之后每次改代码，`git push` 就会自动上线，不需要任何本地工具。
6. **（可选但推荐）加访问控制**：Cloudflare Zero Trust → Access → Applications → 新建一个 Self-hosted 应用，指向这个 Worker 的域名，策略里只允许你自己的邮箱登录。这样即使有人知道网址也进不去。

如果之前配过 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 这两个环境变量，可以去 Worker 的 Settings → Variables 里删掉，代码已经不再用它们。

## 本地开发（可选）

如果以后想在本地跑起来调试，需要装 Node.js，然后：

```
npm install -g wrangler
wrangler login
wrangler dev
```

这只是"发布工具"，装在哪台电脑就只有那台电脑需要装——线上用户访问时完全不需要。
