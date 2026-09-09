/* =============================================================
 * Supabase 云端同步配置（月度打卡直传）
 * -------------------------------------------------------------
 * 填好下面两项后：
 *   - 客户在手机上提交打卡 → 自动直传云端
 *   - 健管师端「拉取打卡」→ 自动从云端取回，无需回传码
 * 未填写或填写错误时，自动回退为现有「回传码」流程，不影响使用。
 *
 * 获取方式（supabase.com，注册免费）：
 *   1. 新建项目 → 左侧「SQL Editor」执行建表 SQL（见项目说明）
 *   2. 左侧「Project Settings → API」页：
 *      - Project URL  → 填到下面 url
 *      - anon public  → 填到下面 anonKey（eyJ 开头的长字符串）
 *
 * ⚠️ 安全提示：这里只能填 anon public key（前端公开密钥，权限由
 *    数据库 RLS 策略限制）。绝不能填 service_role key！
 * ============================================================= */
window.SUPABASE_CFG = {
  url: 'https://vfhzdndbuqcobpwsukbg.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmaHpkbmRidXFjb2Jwd3N1a2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMDI1MjQsImV4cCI6MjEwMjc3ODUyNH0.oIbWFrtL1TgDsPTnOdLt2ENsJ57iGB0-KCp6HTAshqs'
};
