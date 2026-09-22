# Moose Merch Store

独立于 Moose 安装器的实体周边商店草稿。目标地址：
`https://moose-merch.shqingda.workers.dev`。

## 技术栈

- 语义化 HTML5、CSS3、原生 JavaScript，无前端框架和运行时依赖。
- Cloudflare Workers Static Assets 托管，无服务端、数据库或支付逻辑。
- SVG 品牌标志与 JPEG 商品效果图，响应式布局，支持键盘操作和减少动态效果偏好。
- 商品效果图由内置图像生成工具制作；购物袋使用第一方功能 Cookie 保留商品和数量。
- JSON-LD `OnlineStore` 结构化数据、canonical、Open Graph、robots.txt、sitemap.xml
  和 llms.txt。

## 发布前必须确认

- `public/app.js` 中的商品、价格和库存是真实的。
- `public/index.html` 中的配送范围、时效和退换货条款可以实际履行。
- 准备商品实拍图后替换当前的生成效果图。
- 商户行业分类必须与实际销售的实体周边一致。

## 本地预览

```sh
pnpm dlx wrangler@4.135.0 dev --config merch-store/wrangler.jsonc
```

## 部署

```sh
pnpm dlx wrangler@4.135.0 deploy --config merch-store/wrangler.jsonc
```

部署前先运行 `pnpm dlx wrangler@4.135.0 whoami` 确认 Cloudflare 账号。
