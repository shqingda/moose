# Moose 图标生成记录

0.21.3 的 macOS 应用图标是 [moose-icon-white.png](moose-icon-white.png)，官网保留 [moose-icon-black.png](moose-icon-black.png)，会话区使用 [moose-logo-transparent.png](moose-logo-transparent.png)，侧边栏继续读取 [moose-mark.json](moose-mark.json)。资源用途、构建输出与 favicon 主题选择统一维护在[开发指南](../../docs/development.md#图标与品牌资源)，不根据下列历史提示重新选用绿色母图。

## 素材来源

黑底图标与透明 logo 均由内置 imagegen 工具编辑，基于原版拟物图标。黑底版只改变圆角底座颜色，透明版移除底座并保留实心黑眼睛。透明 logo 是单独保存的 PNG，`pnpm icon:build` 不会重新生成它。

原版绿色素材保留为来源记录：

- [moose-icon-skeuomorphic.png](moose-icon-skeuomorphic.png)：早期拟物版本。
- [moose-icon-skeuomorphic-v2.png](moose-icon-skeuomorphic-v2.png)：0.19.1 几何调整；[生成说明](moose-icon-skeuomorphic-v2.md)。
- [moose-icon-skeuomorphic-v3.png](moose-icon-skeuomorphic-v3.png)：细边框和更丰富高光；[生成说明](moose-icon-skeuomorphic-v3.md)。

## 黑底图标提示

Change only the dark green/teal tile to obsidian black. Preserve the gold antlers, ivory moose, silhouette, proportions, texture, shallow relief, edge highlights and upper-left lighting. Keep the exterior transparent and the eye black.

## 白底 Dock 图标

[moose-icon-white.png](moose-icon-white.png) 由内置 imagegen 工具编辑黑底母图生成，作为当前 macOS 应用和 Dock 的打包源。官网仍使用黑底版。

提示：Change only the black rounded-square tile to white ceramic/enamel with soft grey shading. Preserve the tile bounds, thin beveled edge, champagne-gold antler, ivory moose silhouette, solid black eye, shallow relief, upper-left lighting and soft contact shadows. Keep genuine transparent alpha outside the tile.

## 透明 logo 提示

Remove the entire black rounded-square tile, its bevel and shadow. Preserve the gold antlers and ivory moose with their original silhouette, materials and relief. Keep the eye solid opaque black; use genuine transparent alpha around the emblem.

## 初版绿色图标生成提示（历史记录）

Use case: style-transfer. Create the finished production macOS application icon for Moose. Input 1 is the exact Moose icon edit target. Input 2 is a style reference only (grid of vintage iOS skeuomorphic app icons). Preserve the Moose target's exact distinctive right-facing moose head silhouette, single broad four-pronged antler, ear, circular eye, proportions, placement, and palette. Transform the flat graphic into a refined tactile skeuomorphic icon like the reference. Square 1024x1024 transparent canvas. Keep tile bounds near x54 y54 to x970 y970, corner radius about204, perfectly front-facing without perspective. Deep dark teal enamel rounded square base, very fine subtle grain, softly luminous upper surface, darker lower edge, slim nested beveled rim and delicate edge highlights. The original ivory moose head is a shallow raised warm ivory ceramic emblem with soft bevel and very subtle contact shadow, absolutely preserve its flat graphic silhouette (no realistic animal anatomy). Original muted champagne gold antler is satin brass with restrained directional sheen and bevel. Small circular dark teal eye remains. Light from upper left, coherent subtle shadows. Premium, crisp, restrained depth, not cartoon or plastic toy, not extreme glossy or shiny chrome. No additional antlers, no extra facial details, no text, no labels, no wallpaper, no other icons. Transparent outside the rounded square, with minimal soft shadow contained within canvas. Deliver one isolated finished icon, not a mockup sheet.
