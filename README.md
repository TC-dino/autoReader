# AutoReader Scroll (Edge/Chrome MV3)

一个面向“任意网页自动下滑阅读”的浏览器插件（内容脚本注入悬浮控制条）。

## 如何加载（Load unpacked）

1. 打开 Edge/Chrome 扩展管理页
   - Edge：`edge://extensions`
   - Chrome：`chrome://extensions`
2. 打开右上角 `开发者模式`
3. 点击 `加载已解压的扩展程序`
4. 选择本仓库根目录：`autoReader/`

加载后：
- 打开 `test-pages/simple.html` / `nested-scroll.html` / `infinite-scroll.html` 逐个验证；
- 在任意网站右上角会出现悬浮面板，点击 `Start` 开始自动下滑；
- 用户 `wheel/touch/键盘` 触发后会自动 `Paused`，再点 `Resume` 继续。

## 调整参数

主要逻辑在 `contentScript.js`：
- `SPEED_*`：速度范围（px/s）
- `BOTTOM_THRESHOLD_PX`：判定接近底部的容差

