# 作業管理雲端系統 (homework-cloud)

- **線上正式網址**：https://homework-cloud-7ik.pages.dev/
- **Cloudflare Pages 專案**：`homework-cloud`

## 目錄架構
- `public/index.html`：首頁與核心結構
- `public/css/app.css`：蜜桃橙可愛風格樣式
- `public/js/app.js`：日曆、檢核、名單與追蹤功能
- `public/js/cloud.js`：即時雲端同步與 WebSocket 同步

## 部署發布
修改完成後，在終端機中執行：
```powershell
npx wrangler pages deploy public --project-name=homework-cloud
```
即可更新線上版本！
