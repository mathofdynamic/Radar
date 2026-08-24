export function dashboardResponse(): Response {
  return new Response(DASHBOARD_HTML, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/html; charset=UTF-8",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src https://famjljl5gg.ufs.sh; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    }
  });
}

const DASHBOARD_HTML = String.raw`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>رادار / اتاق عملیات</title>
  <style>
    @font-face { font-family: "RadarPersian"; src: url("https://famjljl5gg.ufs.sh/f/aej4FOV7nKCWdXvwA03Yb9TX2i40Gw7yNtgknEQAPWJhYCO8") format("woff2"); font-style: normal; font-weight: 400 700; font-display: swap; }
    @font-face { font-family: "RadarPersian"; src: url("https://famjljl5gg.ufs.sh/f/aej4FOV7nKCWkhCK7UBlTIYdxai4rQEHcnsA2U9h6GjuS0OK") format("woff2"); font-style: normal; font-weight: 800 900; font-display: swap; }
    :root {
      color-scheme: dark;
      --canvas: #0b0d0f;
      --surface: #121619;
      --surface-raised: #171c20;
      --surface-soft: rgba(21, 27, 31, .72);
      --surface-glass: rgba(15, 19, 22, .76);
      --hairline: rgba(218, 232, 233, .12);
      --hairline-strong: rgba(218, 232, 233, .19);
      --ink: #f1f4f2;
      --ink-secondary: #a2aeae;
      --ink-tertiary: #657275;
      --accent: #91a8ff;
      --accent-soft: rgba(145, 168, 255, .12);
      --success: #7bd9ad;
      --cyan: #8bdde7;
      --amber: #efbd70;
      --coral: #ff9480;
      --shadow: 0 28px 80px rgba(0, 0, 0, .26);
      --radius-large: 24px;
      --radius-medium: 16px;
      --radius-small: 11px;
    }
    * { box-sizing: border-box; }
    html { min-width: 320px; background: var(--canvas); }
    body {
      min-width: 320px;
      min-height: 100vh;
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 88% -12%, rgba(145, 168, 255, .10), transparent 30rem),
        radial-gradient(circle at 4% 48%, rgba(139, 221, 231, .035), transparent 28rem),
        var(--canvas);
      font-family: "RadarPersian";
      direction: rtl;
      text-align: right;
      letter-spacing: 0;
    }
    body, button, input, select { font-family: "RadarPersian"; }
    button, input, select { font: inherit; }
    button, a { -webkit-tap-highlight-color: transparent; }
    button { cursor: pointer; }
    a { color: inherit; }
    .hidden { display: none !important; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

    .login-shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; position: relative; overflow: hidden; }
    .login-shell::before { content: ""; position: absolute; width: min(72vw, 680px); aspect-ratio: 1; border: 1px solid rgba(145, 168, 255, .18); border-radius: 50%; box-shadow: 0 0 0 52px rgba(145, 168, 255, .035), 0 0 0 104px rgba(145, 168, 255, .022), 0 0 0 156px rgba(145, 168, 255, .014); transform: translate(25%, -11%); }
    .login-card { width: min(100%, 456px); padding: clamp(28px, 6vw, 48px); border: 1px solid var(--hairline-strong); border-radius: var(--radius-large); background: rgba(18, 22, 25, .86); box-shadow: var(--shadow); position: relative; z-index: 1; backdrop-filter: blur(24px); animation: page-in .6s cubic-bezier(.2, .8, .2, 1) both; }
    .brand-mark { display: inline-flex; align-items: center; gap: 11px; }
    .login-card .brand-mark { margin-bottom: 60px; }
    .radar-dot { width: 13px; height: 13px; display: inline-block; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 6px rgba(145, 168, 255, .12), 0 0 24px rgba(145, 168, 255, .34); }
    .brand-name { color: var(--ink); font-size: 19px; font-weight: 800; line-height: 1; }
    .eyebrow { color: var(--accent); font-size: 11px; font-weight: 700; line-height: 1.3; }
    .login-card h1 { max-width: 9em; margin: 12px 0 14px; font-size: clamp(32px, 6vw, 50px); line-height: 1.05; letter-spacing: -.045em; }
    .login-card p { margin: 0 0 30px; color: var(--ink-secondary); font-size: 14px; line-height: 1.85; }
    .field { display: grid; gap: 8px; margin: 16px 0; }
    .field label { color: var(--ink-secondary); font-size: 12px; }
    .field input { width: 100%; color: var(--ink); background: rgba(7, 10, 12, .72); border: 1px solid var(--hairline); border-radius: var(--radius-small); padding: 14px 15px; outline: none; transition: border-color .2s ease, background .2s ease, box-shadow .2s ease; }
    .field input:hover { background: rgba(7, 10, 12, .92); border-color: var(--hairline-strong); }
    .field input:focus { background: rgba(7, 10, 12, .96); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
    .primary-button, .quiet-button, .outline-button { border: 1px solid transparent; border-radius: var(--radius-small); color: var(--ink); transition: transform .18s ease, border-color .18s ease, background .18s ease, color .18s ease; }
    .primary-button { width: 100%; margin-top: 18px; padding: 14px 16px; background: var(--accent); color: #0b0e14; font-weight: 800; }
    .primary-button:hover { background: #a5b7ff; box-shadow: 0 12px 30px rgba(145, 168, 255, .16); }
    .primary-button:active, .quiet-button:active, .outline-button:active, .nav-link:active { transform: scale(.975); }
    .error-text { min-height: 22px; margin-top: 14px; color: var(--coral); font-size: 12px; }

    .app-shell { display: grid; grid-template-columns: 252px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; padding: 28px 18px 20px; border-left: 1px solid var(--hairline); background: rgba(13, 17, 19, .76); backdrop-filter: blur(24px); z-index: 5; }
    .sidebar-top { padding: 0 10px; }
    .sidebar .brand-mark { margin: 2px 0 58px; }
    .nav-label { margin-bottom: 11px; color: var(--ink-tertiary); font-size: 10px; font-weight: 700; }
    .nav { display: grid; gap: 8px; }
    .nav-link { min-height: 55px; display: grid; grid-template-columns: 46px minmax(0, 1fr); align-items: center; gap: 12px; position: relative; padding: 5px 7px; color: var(--ink-secondary); border: 1px solid transparent; border-radius: 16px; text-decoration: none; font-size: 13px; transition: color .2s ease, background .2s ease, border-color .2s ease, transform .18s ease; }
    .nav-link::after { content: ""; position: absolute; top: 14px; bottom: 14px; right: 0; width: 3px; border-radius: 999px; background: var(--accent); opacity: 0; transform: scaleY(.5); transition: opacity .2s ease, transform .2s ease; }
    .nav-link:hover { color: var(--ink); background: rgba(255, 255, 255, .035); border-color: var(--hairline); }
    .nav-link:hover .nav-glyph { color: var(--ink); border-color: var(--hairline-strong); background: rgba(255, 255, 255, .055); }
    .nav-link.active { color: var(--ink); background: var(--surface-raised); border-color: var(--hairline-strong); box-shadow: 0 10px 28px rgba(0, 0, 0, .16); }
    .nav-link.active::after { opacity: 1; transform: scaleY(1); }
    .nav-link.active .nav-surface { color: var(--ink); }
    .nav-link.active .nav-glyph { color: var(--accent); border-color: rgba(145, 168, 255, .34); background: var(--accent-soft); box-shadow: 0 0 20px rgba(145, 168, 255, .12); }
    .nav-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .nav-surface { min-height: 45px; display: flex; align-items: center; padding: 8px 5px; border: 0; border-radius: 0; background: transparent; font-weight: 700; transition: color .2s ease; }
    .nav-glyph { width: 44px; height: 44px; display: grid; place-items: center; flex: 0 0 44px; color: var(--ink-tertiary); background: var(--surface-soft); border: 1px solid var(--hairline); border-radius: 14px; font-size: 22px; font-weight: 800; line-height: 1; transition: color .2s ease, background .2s ease, border-color .2s ease, transform .2s cubic-bezier(.2, .8, .2, 1), box-shadow .2s ease; }
    .sidebar-foot { margin-top: auto; padding: 17px 10px 0; border-top: 1px solid var(--hairline); color: var(--ink-tertiary); font-size: 10px; line-height: 1.8; }
    .main { width: 100%; max-width: 1540px; min-width: 0; padding: 0 clamp(20px, 4vw, 58px) 70px; }
    .topbar { min-height: 112px; display: flex; align-items: center; justify-content: space-between; gap: 24px; position: sticky; top: 0; z-index: 4; margin-bottom: 38px; border-bottom: 1px solid var(--hairline); background: rgba(11, 13, 15, .78); backdrop-filter: blur(22px); }
    .topbar-copy { min-width: 0; padding: 20px 0; }
    .topbar h1 { margin: 6px 0 0; font-size: clamp(24px, 3vw, 34px); line-height: 1.08; letter-spacing: -.04em; }
    .topbar-description { max-width: 620px; margin: 7px 0 0; color: var(--ink-secondary); font-size: 12px; line-height: 1.7; }
    .topbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
    .live-pill, .status-pill { display: inline-flex; align-items: center; gap: 8px; min-height: 34px; padding: 7px 11px; border: 1px solid var(--hairline); border-radius: 999px; color: var(--ink-secondary); font-size: 10px; white-space: nowrap; }
    .live-pill { color: var(--success); border-color: rgba(123, 217, 173, .25); background: rgba(123, 217, 173, .055); }
    .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 0 rgba(123, 217, 173, .55); animation: pulse 1.8s infinite; }
    .quiet-button, .outline-button { min-height: 34px; padding: 7px 12px; color: var(--ink-secondary); background: var(--surface-soft); border-color: var(--hairline); font-size: 11px; }
    .quiet-button:hover, .outline-button:hover { color: var(--ink); background: var(--surface-raised); border-color: var(--hairline-strong); }
    .outline-button.primary { color: var(--accent); border-color: rgba(145, 168, 255, .33); background: var(--accent-soft); }
    .outline-button.danger:hover { color: var(--coral); border-color: rgba(255, 148, 128, .42); }
    .quiet-button[disabled], .outline-button[disabled] { cursor: wait; opacity: .55; transform: none; }
    .page-content { min-height: 500px; }
    .page-enter { animation: page-in .38s cubic-bezier(.2, .8, .2, 1) both; }
    .page-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
    .page-hero h2 { margin: 0; font-size: clamp(20px, 3vw, 28px); letter-spacing: -.035em; }
    .page-hero p { max-width: 580px; margin: 8px 0 0; color: var(--ink-secondary); font-size: 12px; line-height: 1.75; }
    .page-hero-side { color: var(--ink-tertiary); font-size: 11px; white-space: nowrap; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .metric { min-height: 142px; display: flex; flex-direction: column; justify-content: space-between; padding: 18px; border: 1px solid var(--hairline); border-radius: var(--radius-medium); background: linear-gradient(145deg, rgba(25, 31, 35, .76), rgba(16, 20, 23, .76)); overflow: hidden; position: relative; }
    .metric::after { content: ""; position: absolute; left: -34px; bottom: -42px; width: 112px; height: 112px; border: 1px solid currentColor; border-radius: 50%; opacity: .10; }
    .metric-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--ink-secondary); font-size: 11px; }
    .metric-mark { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 5px rgba(255, 255, 255, .045); }
    .metric-value { margin-top: 20px; color: var(--ink); font-size: clamp(26px, 4vw, 42px); font-weight: 800; line-height: 1; letter-spacing: -.045em; }
    .metric-note { margin-top: 9px; color: var(--ink-tertiary); font-size: 10px; line-height: 1.5; }
    .metric.success { color: var(--success); } .metric.cyan { color: var(--cyan); } .metric.amber { color: var(--amber); } .metric.coral { color: var(--coral); }
    .split { display: grid; grid-template-columns: minmax(0, 1.38fr) minmax(310px, .62fr); gap: 14px; }
    .panel { min-width: 0; border: 1px solid var(--hairline); border-radius: var(--radius-medium); background: var(--surface-glass); box-shadow: 0 14px 44px rgba(0, 0, 0, .12); overflow: hidden; }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 17px 20px; border-bottom: 1px solid var(--hairline); }
    .panel-head h3, .panel-head h4 { margin: 0; font-size: 14px; }
    .panel-head small { color: var(--ink-tertiary); font-size: 10px; }
    .panel-body { padding: 18px 20px; }
    .activity-list { max-height: 540px; padding: 3px 20px 14px; overflow: auto; }
    .activity-item { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 12px; padding: 15px 0; border-bottom: 1px solid var(--hairline); }
    .activity-item:last-child { border-bottom: 0; }
    .activity-beacon { width: 8px; height: 8px; margin-top: 6px; border-radius: 50%; background: var(--ink-tertiary); box-shadow: 0 0 0 4px rgba(255, 255, 255, .045); }
    .activity-beacon.lime { background: var(--success); box-shadow: 0 0 0 4px rgba(123, 217, 173, .10); } .activity-beacon.cyan { background: var(--cyan); box-shadow: 0 0 0 4px rgba(139, 221, 231, .10); } .activity-beacon.amber { background: var(--amber); box-shadow: 0 0 0 4px rgba(239, 189, 112, .10); } .activity-beacon.coral { background: var(--coral); box-shadow: 0 0 0 4px rgba(255, 148, 128, .10); }
    .activity-title { color: var(--ink); font-size: 12px; font-weight: 700; line-height: 1.5; }
    .activity-detail { margin-top: 4px; color: var(--ink-secondary); font-size: 11px; line-height: 1.7; }
    .activity-time { color: var(--ink-tertiary); font-size: 10px; white-space: nowrap; }
    .system-list, .ai-list { display: grid; gap: 0; }
    .ops-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 13px 0; border-bottom: 1px solid var(--hairline); color: var(--ink-secondary); font-size: 11px; }
    .ops-row:first-child { padding-top: 0; }
    .ops-row:last-child { padding-bottom: 0; border-bottom: 0; }
    .ops-row strong { max-width: 65%; color: var(--ink); font-size: 11px; font-weight: 700; text-align: left; overflow-wrap: anywhere; }
    .operator-block { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--hairline); }
    .operator-block h4 { margin: 0 0 12px; font-size: 12px; }
    .action-bar { display: flex; flex-wrap: wrap; gap: 8px; }
    .action-bar .outline-button { flex: 1 1 135px; }
    .publish-control { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 14px; padding: 18px 20px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-medium); background: linear-gradient(135deg, rgba(145, 168, 255, .10), rgba(18, 22, 25, .74)); }
    .publish-control-copy { min-width: 0; }
    .publish-control-kicker { display: block; color: var(--accent); font-size: 10px; font-weight: 800; }
    .publish-control-copy strong { display: block; margin-top: 7px; color: var(--ink); font-size: 16px; }
    .publish-control-copy p { margin: 6px 0 0; color: var(--ink-secondary); font-size: 11px; line-height: 1.75; }
    .toggle-button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; flex: 0 0 auto; min-height: 42px; padding: 8px 12px; color: var(--ink-secondary); background: var(--surface-soft); border: 1px solid var(--hairline); border-radius: 999px; font-size: 11px; transition: transform .18s ease, color .2s ease, background .2s ease, border-color .2s ease; }
    .toggle-button:hover { color: var(--ink); background: var(--surface-raised); border-color: var(--hairline-strong); }
    .toggle-button:active { transform: scale(.97); }
    .toggle-button:disabled { cursor: wait; opacity: .6; }
    .toggle-track { width: 35px; height: 20px; display: inline-flex; align-items: center; padding: 2px; border-radius: 999px; background: var(--ink-tertiary); transition: background .2s ease; }
    .toggle-track i { width: 16px; height: 16px; display: block; border-radius: 50%; background: var(--ink); box-shadow: 0 2px 7px rgba(0, 0, 0, .3); transition: transform .2s cubic-bezier(.2, .8, .2, 1); }
    .toggle-button.enabled { color: var(--success); border-color: rgba(123, 217, 173, .30); background: rgba(123, 217, 173, .07); }
    .toggle-button.enabled .toggle-track { background: var(--success); }
    .toggle-button.enabled .toggle-track i { transform: translateX(-15px); }
    .skeleton { padding: 38px 18px; color: var(--ink-tertiary); text-align: center; font-size: 11px; }
    .empty-state { padding: 72px 24px; text-align: center; }
    .empty-state strong { display: block; margin-bottom: 7px; color: var(--ink); font-size: 14px; }
    .empty-state span { color: var(--ink-secondary); font-size: 11px; }
    .tool-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
    .filter-group { display: flex; gap: 6px; flex-wrap: wrap; }
    .filter-button { min-height: 33px; padding: 7px 12px; color: var(--ink-secondary); background: transparent; border: 1px solid var(--hairline); border-radius: 999px; font-size: 10px; transition: .18s ease; }
    .filter-button:hover, .filter-button.active { color: var(--ink); background: var(--surface-raised); border-color: var(--hairline-strong); }
    .search-input, .select-input { min-height: 37px; color: var(--ink); background: var(--surface-soft); border: 1px solid var(--hairline); border-radius: var(--radius-small); padding: 7px 12px; outline: none; font-size: 11px; }
    .search-input { width: min(100%, 280px); }
    .search-input:focus, .select-input:focus { border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft); }
    .news-list { display: grid; gap: 10px; }
    .news-item { display: grid; grid-template-columns: 145px minmax(0, 1fr) auto; gap: 22px; padding: 20px; border: 1px solid var(--hairline); border-radius: var(--radius-medium); background: var(--surface-glass); transition: border-color .2s ease, transform .2s ease, background .2s ease; }
    .news-item:hover { background: var(--surface-raised); border-color: var(--hairline-strong); transform: translateY(-1px); }
    .news-source { display: flex; flex-direction: column; gap: 7px; align-items: flex-start; }
    .source-bullet { width: 9px; height: 9px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 0 5px rgba(139, 221, 231, .09); }
    .source-bullet.noise { background: var(--ink-tertiary); box-shadow: 0 0 0 5px rgba(101, 114, 117, .08); }
    .news-source strong { color: var(--ink); font-size: 12px; }
    .news-source small { color: var(--ink-tertiary); direction: ltr; font-size: 10px; }
    .news-source time { margin-top: auto; color: var(--ink-tertiary); font-size: 10px; }
    .news-content { min-width: 0; }
    .news-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 10px; }
    .news-content h3 { margin: 0; color: var(--ink); font-size: 15px; line-height: 1.65; }
    .news-content p { margin: 10px 0 0; color: var(--ink-secondary); font-size: 12px; line-height: 1.85; }
    .news-actions { align-self: end; }
    .external-link { display: inline-flex; align-items: center; gap: 5px; color: var(--cyan); text-decoration: none; font-size: 10px; white-space: nowrap; }
    .external-link:hover { text-decoration: underline; }
    .chip { display: inline-flex; align-items: center; min-height: 24px; padding: 4px 8px; border: 1px solid var(--hairline); border-radius: 999px; color: var(--ink-secondary); font-size: 9px; white-space: nowrap; }
    .chip.lime { color: var(--success); border-color: rgba(123, 217, 173, .27); background: rgba(123, 217, 173, .06); }
    .chip.cyan { color: var(--cyan); border-color: rgba(139, 221, 231, .27); background: rgba(139, 221, 231, .06); }
    .chip.amber { color: var(--amber); border-color: rgba(239, 189, 112, .27); background: rgba(239, 189, 112, .06); }
    .chip.coral { color: var(--coral); border-color: rgba(255, 148, 128, .27); background: rgba(255, 148, 128, .06); }
    .event-list { display: grid; gap: 10px; }
    .event-card { display: grid; grid-template-columns: 90px minmax(0, 1fr) 150px; gap: 20px; align-items: start; padding: 20px; border: 1px solid var(--hairline); border-radius: var(--radius-medium); background: var(--surface-glass); transition: border-color .2s ease, background .2s ease; }
    .event-card:hover { background: var(--surface-raised); border-color: var(--hairline-strong); }
    .event-score { padding-left: 20px; border-left: 1px solid var(--hairline); }
    .event-score span { display: block; color: var(--ink-tertiary); font-size: 9px; }
    .event-score strong { display: block; margin-top: 7px; color: var(--accent); font-size: 34px; font-weight: 800; line-height: 1; letter-spacing: -.05em; }
    .event-main h3 { margin: 8px 0 8px; color: var(--ink); font-size: 14px; line-height: 1.7; }
    .event-main p { margin: 0; color: var(--ink-secondary); font-size: 11px; line-height: 1.8; }
    .event-meta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 14px; color: var(--ink-tertiary); font-size: 10px; }
    .event-side { display: grid; justify-items: start; gap: 8px; }
    .event-side small { color: var(--ink-tertiary); font-size: 10px; }
    .health-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
    .health-card { padding: 17px; border: 1px solid var(--hairline); border-radius: var(--radius-medium); background: var(--surface-glass); }
    .health-card span { display: block; color: var(--ink-secondary); font-size: 11px; }
    .health-card strong { display: block; margin-top: 12px; color: var(--ink); font-size: 26px; line-height: 1; }
    .health-card.success strong { color: var(--success); } .health-card.warning strong { color: var(--amber); } .health-card.danger strong { color: var(--coral); }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; min-width: 760px; border-collapse: collapse; }
    th, td { padding: 14px 17px; border-bottom: 1px solid var(--hairline); vertical-align: top; text-align: right; }
    th { color: var(--ink-tertiary); font-size: 10px; font-weight: 700; white-space: nowrap; }
    td { color: var(--ink-secondary); font-size: 11px; }
    tbody tr:last-child td { border-bottom: 0; }
    tbody tr:hover td { background: rgba(255, 255, 255, .018); }
    td strong { color: var(--ink); font-weight: 700; }
    .source-cell { display: flex; align-items: center; gap: 9px; }
    .source-led { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: var(--ink-tertiary); }
    .source-led.healthy { background: var(--success); box-shadow: 0 0 10px rgba(123, 217, 173, .4); }
    .source-led.invalid, .source-led.degraded { background: var(--coral); }
    .source-led.pending_validation { background: var(--amber); }
    .source-handle { margin-top: 5px; color: var(--ink-tertiary); direction: ltr; font-size: 10px; text-align: right; }
    .story-list { display: grid; gap: 10px; }
    .story-item { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 20px; padding: 20px; border: 1px solid var(--hairline); border-radius: var(--radius-medium); background: var(--surface-glass); }
    .story-item h3 { margin: 0; color: var(--ink); font-size: 14px; line-height: 1.7; }
    .story-item p { margin: 10px 0 0; color: var(--ink-secondary); font-size: 11px; line-height: 1.8; }
    .story-meta { display: flex; align-items: flex-start; justify-content: flex-start; gap: 7px; flex-wrap: wrap; }
    .story-time { margin-top: 12px; color: var(--ink-tertiary); font-size: 10px; }
    .system-grid { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); gap: 14px; }
    .destination { display: inline-block; max-width: 100%; color: var(--cyan); direction: ltr; font-size: 11px; overflow-wrap: anywhere; text-align: left; }
    .budget-row { display: grid; gap: 8px; padding: 13px 0; border-bottom: 1px solid var(--hairline); }
    .budget-row:last-child { border-bottom: 0; }
    .budget-label { display: flex; justify-content: space-between; gap: 10px; color: var(--ink-secondary); font-size: 11px; }
    .budget-label strong { color: var(--ink); font-size: 10px; }
    .progress { height: 5px; overflow: hidden; border-radius: 999px; background: rgba(255, 255, 255, .08); }
    .progress i { display: block; height: 100%; max-width: 100%; border-radius: inherit; background: var(--accent); }
    .progress i.cyan { background: var(--cyan); } .progress i.amber { background: var(--amber); } .progress i.coral { background: var(--coral); }
    .flash { position: fixed; left: 24px; bottom: 24px; z-index: 20; max-width: min(380px, calc(100vw - 48px)); padding: 13px 16px; border: 1px solid var(--hairline-strong); border-radius: var(--radius-small); background: #1a2227; box-shadow: var(--shadow); color: var(--ink); font-size: 12px; transform: translateY(14px); opacity: 0; pointer-events: none; transition: transform .25s ease, opacity .25s ease; }
    .flash.show { transform: translateY(0); opacity: 1; }
    .flash.error { color: var(--coral); border-color: rgba(255, 148, 128, .4); }
    .page-footer { margin-top: 46px; color: var(--ink-tertiary); font-size: 10px; }

    @keyframes pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(123, 217, 173, .5); } 50% { box-shadow: 0 0 0 7px rgba(123, 217, 173, 0); } }
    @keyframes page-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 1200px) { .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .split, .system-grid { grid-template-columns: 1fr; } }
    @media (max-width: 860px) {
      .app-shell { display: block; }
      .sidebar { position: sticky; top: 0; height: auto; padding: 13px 16px 12px; border-left: 0; border-bottom: 1px solid var(--hairline); }
      .sidebar-top { padding: 0; }
      .sidebar .brand-mark { margin: 2px 4px 15px; }
      .nav-label, .sidebar-foot { display: none; }
      .nav { display: flex; gap: 6px; overflow-x: auto; padding: 0 1px 2px; scrollbar-width: none; }
      .nav::-webkit-scrollbar { display: none; }
      .nav-link { min-height: 44px; grid-template-columns: 36px auto; gap: 8px; flex: 0 0 auto; padding: 4px 6px; font-size: 11px; }
      .nav-link::after { top: 9px; bottom: 9px; }
      .nav-surface { min-height: 36px; padding: 6px 4px; }
      .nav-glyph { width: 36px; height: 36px; flex-basis: 36px; border-radius: 11px; font-size: 19px; }
      .main { padding: 0 16px 48px; }
      .topbar { min-height: 98px; margin-bottom: 28px; }
      .topbar-description { display: none; }
      .topbar-actions { gap: 6px; }
      .topbar-actions .status-pill { display: none; }
      .page-hero { align-items: flex-start; flex-direction: column; gap: 8px; }
      .news-item { grid-template-columns: 110px minmax(0, 1fr); gap: 16px; }
      .news-actions { grid-column: 2; }
      .event-card { grid-template-columns: 68px minmax(0, 1fr); gap: 15px; }
      .event-side { grid-column: 2; display: flex; align-items: center; }
      .story-item { grid-template-columns: 1fr; gap: 13px; }
      .publish-control { align-items: flex-start; flex-direction: column; }
      .toggle-button { width: 100%; }
    }
    @media (max-width: 560px) {
      .login-card { padding: 30px 24px; }
      .login-card .brand-mark { margin-bottom: 43px; }
      .topbar { align-items: flex-start; flex-direction: column; padding: 16px 0 14px; gap: 13px; }
      .topbar-copy { padding: 0; }
      .topbar-actions { justify-content: flex-start; }
      .metric { min-height: 124px; padding: 15px; }
      .metric-value { margin-top: 15px; font-size: 28px; }
      .panel-head, .panel-body { padding-right: 15px; padding-left: 15px; }
      .activity-list { padding-right: 15px; padding-left: 15px; }
      .news-item { display: block; padding: 16px; }
      .news-source { flex-direction: row; align-items: center; margin-bottom: 15px; }
      .news-source time { margin-top: 0; margin-right: auto; }
      .news-actions { margin-top: 15px; }
      .event-card { display: block; padding: 16px; }
      .event-score { padding: 0 0 13px; margin-bottom: 13px; border-left: 0; border-bottom: 1px solid var(--hairline); }
      .event-score strong { display: inline; margin-right: 8px; font-size: 27px; }
      .event-side { margin-top: 14px; }
      .health-grid { grid-template-columns: 1fr; }
      .health-card { display: flex; align-items: center; justify-content: space-between; }
      .health-card strong { margin-top: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
    @media (prefers-reduced-transparency: reduce) { .sidebar, .topbar, .panel, .news-item, .event-card, .story-item, .metric { background: var(--surface); backdrop-filter: none; } }
  </style>
</head>
<body>
  <section id="login-view" class="login-shell">
    <form id="login-form" class="login-card">
      <div class="brand-mark"><span class="radar-dot"></span><span class="brand-name">رادار</span></div>
      <div class="eyebrow">اتاق عملیات خصوصی</div>
      <h1>نبض خبر را ببینید.</h1>
      <p>گردآوری، شواهد، راستی‌آزمایی، تصمیم‌های تحریریه و انتشار را در نماهایی روشن و متمرکز زیر نظر بگیرید.</p>
      <div class="field"><label for="username">نام کاربری</label><input id="username" name="username" autocomplete="username" required /></div>
      <div class="field"><label for="password">گذرواژه</label><input id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <button class="primary-button" type="submit">ورود به اتاق عملیات</button>
      <div id="login-error" class="error-text" role="alert"></div>
    </form>
  </section>

  <div id="app-view" class="app-shell hidden">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="brand-mark"><span class="radar-dot"></span><span class="brand-name">رادار</span></div>
        <div class="nav-label">اتاق کنترل</div>
        <nav class="nav" aria-label="ناوبری اتاق عملیات">
          <a class="nav-link" data-route="pulse" href="/admin"><span class="nav-glyph" aria-hidden="true">◉</span><span class="nav-surface">نبض</span></a>
          <a class="nav-link" data-route="news" href="/admin/news"><span class="nav-glyph" aria-hidden="true">↗</span><span class="nav-surface">ورودی خبر</span></a>
          <a class="nav-link" data-route="events" href="/admin/events"><span class="nav-glyph" aria-hidden="true">◎</span><span class="nav-surface">رویدادها</span></a>
          <a class="nav-link" data-route="sources" href="/admin/sources"><span class="nav-glyph" aria-hidden="true">⌁</span><span class="nav-surface">منابع</span></a>
          <a class="nav-link" data-route="publish" href="/admin/publish"><span class="nav-glyph" aria-hidden="true">↥</span><span class="nav-surface">انتشار</span></a>
          <a class="nav-link" data-route="system" href="/admin/system"><span class="nav-glyph" aria-hidden="true">▦</span><span class="nav-surface">سامانه</span></a>
        </nav>
      </div>
      <div class="sidebar-foot">نسخه ابری / گردآوری دوره‌ای<br />هوشمندی اخبار فارسی</div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div class="topbar-copy"><div id="page-kicker" class="eyebrow">رادار / اتاق عملیات</div><h1 id="page-title">نبض</h1><p id="page-description" class="topbar-description">نمایی آرام از سلامت و جریان اصلی سامانه.</p></div>
        <div class="topbar-actions"><span id="live-status" class="live-pill"><i class="live-dot"></i> زنده / ۶۰ ثانیه</span><span id="last-updated" class="status-pill">در انتظار همگام‌سازی</span><button id="refresh-button" class="quiet-button" type="button">به‌روزرسانی</button><button id="logout-button" class="quiet-button" type="button">خروج</button></div>
      </header>
      <div id="page-content" class="page-content"><div class="panel skeleton">در حال آماده‌سازی اتاق عملیات…</div></div>
      <footer class="page-footer">رادار / پایگاه داده مرجع اصلی / همگام‌سازی خودکار هر ۶۰ ثانیه</footer>
    </main>
  </div>
  <div id="flash" class="flash" role="status"></div>
  <script>
    (function () {
      "use strict";
      var loginView = document.getElementById("login-view");
      var appView = document.getElementById("app-view");
      var loginForm = document.getElementById("login-form");
      var loginError = document.getElementById("login-error");
      var pageContent = document.getElementById("page-content");
      var flash = document.getElementById("flash");
      var refreshTimer = null;
      var flashTimer = null;
      var snapshot = null;
      var newsQuery = "";
      var newsFilter = "all";
      var eventFilter = "all";

      var pageMeta = {
        pulse: { title: "نبض", description: "نمایی آرام از سلامت و جریان اصلی سامانه." },
        news: { title: "ورودی خبر", description: "پست‌های عمومی تازه‌دریافت‌شده، پیش از تبدیل‌شدن به رویداد." },
        events: { title: "رویدادها", description: "خوشه‌های هوشمند خبر، راستی‌آزمایی و تصمیم تحریریه." },
        sources: { title: "منابع", description: "سلامت، اولویت و مکان‌نمای دریافت هر منبع عمومی." },
        publish: { title: "انتشار", description: "وضعیت خبرهایی که برای انتشار یا به‌روزرسانی ثبت شده‌اند." },
        system: { title: "سامانه", description: "کنترل‌های اپراتور، مقصد انتشار و مصرف هوش مصنوعی." }
      };

      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]; });
      }
      function safeUrl(value) {
        try { var parsed = new URL(value); return parsed.protocol === "https:" ? escapeHtml(parsed.href) : "#"; } catch (_) { return "#"; }
      }
      function toFaDigits(value) { return String(value == null ? "" : value).replace(/[0-9]/g, function (digit) { return "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]; }); }
      function translateStatus(value) {
        var labels = { CONFIRMED: "تأییدشده", DEVELOPING: "در حال شکل‌گیری", DISPUTED: "مورد اختلاف", UNVERIFIED: "تأییدنشده", PUBLISH: "انتشار", MONITOR: "پایش", IGNORE: "نادیده‌گرفتن", queued: "در صف", pending: "در انتظار", processing: "در حال انتشار", failed: "ناموفق", published: "منتشرشده", processed: "پردازش‌شده", noise: "نویز", filtered: "فیلترشده", healthy: "سالم", degraded: "تنزل‌یافته", invalid: "نامعتبر", inactive: "غیرفعال", pending_validation: "در انتظار اعتبارسنجی", update_pending: "در انتظار به‌روزرسانی", updated: "به‌روزشده", suppressed_duplicate: "تکراری / مهارشده" };
        return labels[value] || value || "—";
      }
      function translatePriority(value) {
        var labels = { TIER_1: "اولویت ۱", TIER_2: "اولویت ۲", TIER_3: "اولویت ۳" };
        return labels[value] || value || "—";
      }
      function translateStage(value) {
        var labels = { intelligence: "درک رویداد", intelligence_second_pass: "رفع ابهام", stage1: "تحلیل اولیه", stage2: "بررسی تحریریه", cover: "تصویر خبری", editorial: "تحریریه" };
        return labels[value] || value || "—";
      }
      function translateCategory(value) {
        var labels = { politics: "سیاست", economy: "اقتصاد", security: "امنیت", technology: "فناوری", society: "جامعه", international: "بین‌الملل", market: "بازار", other: "سایر" };
        return labels[value] || value || "—";
      }
      function translateError(value) {
        var text = String(value || "");
        var labels = { unauthorized: "نشست شما منقضی شده است.", request_failed: "درخواست ناموفق بود.", dashboard_credentials_not_configured: "اطلاعات ورود پنل تنظیم نشده است.", no_public_posts: "پست عمومی پیدا نشد.", validation_failed: "اعتبارسنجی ناموفق بود.", invalid_enabled: "وضعیت انتشار نامعتبر است.", publishing_disabled: "انتشار تلگرام متوقف است.", unknown: "خطای نامشخص" };
        if (labels[text]) return labels[text];
        if (/^http_\d+$/.test(text)) return "خطای دریافت «" + text.slice(5) + "»";
        if (text === "Source health changed") return "وضعیت سلامت منبع تغییر کرد.";
        if (text.indexOf("telegram_publish_failed:") === 0) return "تلگرام پیام را نپذیرفت؛ جزئیات در گزارش سامانه ثبت شده است.";
        return "خطا در اجرای درخواست";
      }
      function localizeActivityTitle(value) {
        var text = String(value || "");
        ["CONFIRMED", "DEVELOPING", "DISPUTED", "UNVERIFIED"].forEach(function (status) { text = text.replace(status, translateStatus(status)); });
        text = text.replace("Story published", "خبر منتشر شد").replace(/Story (pending|queued)/, function (_, status) { return "خبر " + translateStatus(status); });
        text = text.replace(" / message ", " / پیام ");
        return text.replace(/ · (healthy|degraded|invalid|inactive)$/, function (_, status) { return " · " + translateStatus(status); });
      }
      function localizeActivityDetail(value) {
        var text = String(value || "");
        text = text.replace(/(\d+) sources? · score (\d+)/, function (_, sources, score) { return toFaDigits(sources) + " منبع · امتیاز " + toFaDigits(score); });
        return text === "Source health changed" ? "وضعیت سلامت منبع تغییر کرد." : text;
      }
      function formatTime(value) {
        if (!value) return "—";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return escapeHtml(value);
        return new Intl.DateTimeFormat("fa-IR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
      }
      function relativeTime(value) {
        if (!value) return "—";
        var timestamp = new Date(value).getTime();
        if (Number.isNaN(timestamp)) return "—";
        var seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
        if (seconds < 60) return seconds < 5 ? "همین حالا" : toFaDigits(seconds) + " ثانیه پیش";
        if (seconds < 3600) return toFaDigits(Math.floor(seconds / 60)) + " دقیقه پیش";
        if (seconds < 86400) return toFaDigits(Math.floor(seconds / 3600)) + " ساعت پیش";
        return toFaDigits(Math.floor(seconds / 86400)) + " روز پیش";
      }
      function chip(text, tone) { return '<span class="chip ' + (tone || "") + '">' + escapeHtml(text) + '</span>'; }
      function toneForStatus(value) { return value === "CONFIRMED" || value === "published" || value === "processed" || value === "healthy" ? "lime" : value === "DISPUTED" || value === "failed" || value === "invalid" || value === "degraded" ? "coral" : value === "DEVELOPING" || value === "processing" ? "cyan" : "amber"; }
      function showFlash(message, isError) {
        flash.textContent = message;
        flash.className = "flash show" + (isError ? " error" : "");
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { flash.className = "flash"; }, 4500);
      }
      function pageFromPath() {
        var path = window.location.pathname.replace(/\/+$/, "") || "/admin";
        if (path === "/admin") return "pulse";
        var key = path.split("/").pop();
        return pageMeta[key] ? key : "pulse";
      }
      function normalizedPath(page) { return page === "pulse" ? "/admin" : "/admin/" + page; }
      function showLogin(message) {
        appView.classList.add("hidden");
        loginView.classList.remove("hidden");
        loginError.textContent = message || "";
        if (refreshTimer) clearInterval(refreshTimer);
      }
      function showApp() { loginView.classList.add("hidden"); appView.classList.remove("hidden"); }
      function updateChrome() {
        var page = pageFromPath();
        var meta = pageMeta[page];
        document.getElementById("page-kicker").textContent = "رادار / اتاق عملیات";
        document.getElementById("page-title").textContent = meta.title;
        document.getElementById("page-description").textContent = meta.description;
        document.title = "رادار / " + meta.title;
        document.querySelectorAll("[data-route]").forEach(function (link) {
          var active = link.getAttribute("data-route") === page;
          link.classList.toggle("active", active);
          if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
        });
      }
      function navigate(page, replace) {
        var nextPath = normalizedPath(page);
        if (window.location.pathname !== nextPath) {
          if (replace) window.history.replaceState({}, "", nextPath); else window.history.pushState({}, "", nextPath);
        }
        updateChrome();
        if (snapshot) render(snapshot);
      }
      function pageHeader(title, description, side) {
        return '<div class="page-hero"><div><h2>' + title + '</h2><p>' + description + '</p></div>' + (side ? '<div class="page-hero-side">' + side + '</div>' : '') + '</div>';
      }
      function pulseMarkup() {
        return pageHeader("نبض سامانه", "تصویر روزانهٔ سلامت دریافت، تحلیل و انتشار در یک نگاه.", '<span id="pulse-state">در انتظار داده</span>') +
          '<div class="metric-grid"><article class="metric success"><div class="metric-top"><span>منابع فعال</span><i class="metric-mark"></i></div><div id="metric-sources" class="metric-value">—</div><div id="metric-sources-note" class="metric-note">—</div></article><article class="metric cyan"><div class="metric-top"><span>خبرهای دیده‌شده</span><i class="metric-mark"></i></div><div id="metric-posts" class="metric-value">—</div><div class="metric-note">شمارندهٔ امروز</div></article><article class="metric amber"><div class="metric-top"><span>رویدادهای شکل‌گرفته</span><i class="metric-mark"></i></div><div id="metric-events" class="metric-value">—</div><div class="metric-note">خوشه‌های تحلیلی</div></article><article class="metric coral"><div class="metric-top"><span>خطاهای سامانه</span><i class="metric-mark"></i></div><div id="metric-failures" class="metric-value">—</div><div class="metric-note">خطاهای صف امروز</div></article></div>' +
          '<div class="split"><article class="panel"><div class="panel-head"><h3>جریان فعالیت</h3><small id="activity-count">—</small></div><div id="pulse-activity" class="activity-list"><div class="skeleton">در حال اتصال به جریان فعالیت…</div></div></article><article class="panel"><div class="panel-head"><h3>وضعیت سامانه</h3><small id="pulse-environment">—</small></div><div id="pulse-system" class="panel-body"><div class="skeleton">در انتظار داده‌های سامانه…</div></div></article></div>';
      }
      function newsMarkup() {
        return pageHeader("ورودی خبر", "پست‌های خام و نرمال‌سازی‌شده را پیش از ورود به هوشمندی رویداد بررسی کنید.", '<span id="news-count">—</span>') +
          '<div class="tool-row"><div class="filter-group"><button type="button" class="filter-button active" data-news-filter="all">همه</button><button type="button" class="filter-button" data-news-filter="processed">پردازش‌شده</button><button type="button" class="filter-button" data-news-filter="pending">در انتظار</button><button type="button" class="filter-button" data-news-filter="noise">نویز</button></div><label><span class="sr-only">جست‌وجوی خبر</span><input id="news-search" class="search-input" type="search" placeholder="جست‌وجو در متن خبر" /></label></div><div id="news-list" class="news-list"><div class="panel skeleton">در حال دریافت پست‌ها…</div></div>';
      }
      function eventsMarkup() {
        return pageHeader("رویدادها", "هر رویداد از چند گزارش به یک پروندهٔ قابل بررسی برای تحریریه تبدیل می‌شود.", '<span id="events-count">—</span>') +
          '<div class="tool-row"><div class="filter-group"><button type="button" class="filter-button active" data-event-filter="all">همه</button><button type="button" class="filter-button" data-event-filter="CONFIRMED">تأییدشده</button><button type="button" class="filter-button" data-event-filter="DEVELOPING">در حال شکل‌گیری</button><button type="button" class="filter-button" data-event-filter="DISPUTED">مورد اختلاف</button><button type="button" class="filter-button" data-event-filter="UNVERIFIED">تأییدنشده</button></div></div><div id="event-list" class="event-list"><div class="panel skeleton">در حال دریافت رویدادها…</div></div>';
      }
      function sourcesMarkup() {
        return pageHeader("دفتر منابع", "سلامت دریافت و اولویت منابع عمومی را بدون شلوغی یک نمای طولانی کنترل کنید.", '<button id="sources-validate-button" class="outline-button primary" type="button">اعتبارسنجی همهٔ منابع</button>') +
          '<div id="health-grid" class="health-grid"><div class="health-card success"><span>سالم</span><strong>—</strong></div><div class="health-card warning"><span>در انتظار بررسی</span><strong>—</strong></div><div class="health-card danger"><span>نیازمند توجه</span><strong>—</strong></div></div><div class="panel table-wrap"><table><thead><tr><th>منبع</th><th>وضعیت</th><th>دسته</th><th>اولویت</th><th>آخرین دریافت</th><th>مکان‌نما</th><th>آخرین خطا</th></tr></thead><tbody id="source-table"><tr><td colspan="7" class="skeleton">هنوز منبعی ثبت نشده است.</td></tr></tbody></table></div>';
      }
      function publishMarkup() {
        return pageHeader("دفتر انتشار", "وضعیت خبرهای نهایی، انتشار تلگرام و خطاهای قابل پیگیری را جدا از جریان دریافت ببینید.", '<span id="publish-count">—</span>') +
          '<div id="story-list" class="story-list"><div class="panel skeleton">در حال دریافت سوابق انتشار…</div></div>';
      }
      function systemMarkup() {
        return pageHeader("سامانه", "کنترل‌های اجرایی و مصرف منابع در یک فضای جدا و قابل اقدام.", '<span id="system-mode">—</span>') +
          '<section class="publish-control" aria-labelledby="publishing-title"><div class="publish-control-copy"><span class="publish-control-kicker">انتشار تلگرام</span><strong id="publishing-title">در حال دریافت وضعیت…</strong><p id="publishing-help">وضعیت کنترل انتشار در حال همگام‌سازی است.</p></div><button id="publishing-toggle" class="toggle-button" type="button" aria-pressed="false"><span class="toggle-track" aria-hidden="true"><i></i></span><span id="publishing-toggle-label">در حال دریافت</span></button></section><div class="system-grid"><article class="panel"><div class="panel-head"><h3>اطلاعات اجرایی</h3><small>پایگاه داده مرجع اصلی</small></div><div id="system-details" class="panel-body"><div class="skeleton">در انتظار داده‌های سامانه…</div></div><div class="panel-body operator-block"><h4>اقدام‌های اپراتور</h4><div class="action-bar"><button id="system-validate-button" class="outline-button" type="button">اعتبارسنجی منابع</button><button id="system-telegram-button" class="outline-button" type="button">بررسی اتصال تلگرام</button><button id="system-requeue-button" class="outline-button" type="button">بازگردانی موارد در انتظار</button></div></div></article><article class="panel"><div class="panel-head"><h3>بودجهٔ هوش مصنوعی</h3><small>امروز</small></div><div id="ai-list" class="panel-body"><div class="skeleton">هنوز مصرفی ثبت نشده است.</div></div></article></div>';
      }
      function renderPage(data) {
        var page = pageFromPath();
        var markup = page === "news" ? newsMarkup() : page === "events" ? eventsMarkup() : page === "sources" ? sourcesMarkup() : page === "publish" ? publishMarkup() : page === "system" ? systemMarkup() : pulseMarkup();
        pageContent.innerHTML = markup;
        pageContent.classList.remove("page-enter");
        void pageContent.offsetWidth;
        pageContent.classList.add("page-enter");
        if (page === "news") renderNews(data.posts);
        if (page === "events") renderEvents(data.events, data.candidates);
        if (page === "sources") renderSources(data.sources);
        if (page === "publish") renderStories(data.stories);
        if (page === "system") { renderSystemDetails(data); renderAi(data); }
        if (page === "pulse") { renderPulse(data); }
        bindFilters();
        bindActionButtons();
      }
      function render(data) {
        snapshot = data;
        showApp();
        updateChrome();
        document.getElementById("last-updated").textContent = "همگام‌شده " + relativeTime(data.generatedAt);
        document.getElementById("live-status").innerHTML = '<i class="live-dot"></i> ' + (data.system.publishingEnabled ? "انتشار زنده" : "پایش زنده") + " / ۶۰ ثانیه";
        renderPage(data);
      }
      function renderPulse(data) {
        var overview = data.overview;
        document.getElementById("metric-sources").textContent = toFaDigits(overview.sourcesActive) + "/" + toFaDigits(overview.sourcesTotal);
        document.getElementById("metric-sources-note").textContent = toFaDigits(overview.sourcesDegraded) + " منبع ناسالم یا نامعتبر";
        document.getElementById("metric-posts").textContent = toFaDigits(overview.postsObserved);
        document.getElementById("metric-events").textContent = toFaDigits(overview.eventsCreated);
        document.getElementById("metric-failures").textContent = toFaDigits(overview.queueFailures);
        document.getElementById("pulse-state").textContent = data.system.publishingEnabled ? "انتشار فعال" : "انتشار متوقف";
        document.getElementById("activity-count").textContent = toFaDigits(data.activity.length) + " رخداد";
        document.getElementById("pulse-environment").textContent = data.system.environment === "production" ? "محیط تولید" : data.system.environment;
        renderActivity(data.activity, "pulse-activity");
        renderSystemRows(data, "pulse-system");
      }
      function renderActivity(items, targetId) {
        var target = document.getElementById(targetId);
        if (!target) return;
        if (!items.length) { target.innerHTML = '<div class="skeleton">هنوز فعالیتی ثبت نشده است.</div>'; return; }
        target.innerHTML = items.map(function (item) { return '<div class="activity-item"><i class="activity-beacon ' + escapeHtml(item.tone) + '"></i><div><div class="activity-title">' + escapeHtml(localizeActivityTitle(item.title)) + '</div><div class="activity-detail">' + escapeHtml(localizeActivityDetail(item.detail)) + (item.url ? ' · <a class="external-link" target="_blank" rel="noreferrer" href="' + safeUrl(item.url) + '">مشاهده منبع ↗</a>' : '') + '</div></div><time class="activity-time">' + relativeTime(item.timestamp) + '</time></div>'; }).join("");
      }
      function renderSystemRows(data, targetId) {
        var target = document.getElementById(targetId);
        if (!target) return;
        var overview = data.overview;
        var rows = [["مقصد انتشار", '<a class="destination" target="_blank" rel="noreferrer" href="' + safeUrl(data.system.destinationUrl) + '">' + escapeHtml(data.system.destinationUrl) + '</a>'], ["آخرین دریافت", overview.latestPollAt ? relativeTime(overview.latestPollAt) : "هنوز انجام نشده"], ["پست‌های خام ثبت‌شده", toFaDigits(overview.rawPostsPersisted)], ["پاکت‌های دریافت‌شده در صف", toFaDigits(overview.pollEnvelopesQueued)], ["تماس‌های هوش مصنوعی / نورون‌ها", toFaDigits(overview.aiCalls) + " / " + toFaDigits(overview.aiNeurons)]];
        target.innerHTML = rows.map(function (row) { return '<div class="ops-row"><span>' + row[0] + '</span><strong>' + row[1] + '</strong></div>'; }).join("");
      }
      function renderNews(posts) {
        var target = document.getElementById("news-list");
        if (!target) return;
        var query = newsQuery.trim().toLocaleLowerCase();
        var filtered = posts.filter(function (post) {
          var matchesFilter = newsFilter === "all" || (newsFilter === "noise" ? post.isNoise : newsFilter === post.processingStatus);
          var haystack = (post.sourceName + " " + post.originalText + " " + post.normalizedText).toLocaleLowerCase();
          return matchesFilter && (!query || haystack.indexOf(query) !== -1);
        });
        document.getElementById("news-count").textContent = toFaDigits(filtered.length) + " پست";
        if (!filtered.length) { target.innerHTML = '<div class="panel empty-state"><strong>نتیجه‌ای پیدا نشد</strong><span>فیلتر یا عبارت جست‌وجو را تغییر دهید.</span></div>'; return; }
        target.innerHTML = filtered.slice(0, 60).map(function (post) {
          var status = post.isNoise ? "نویز / " + translateStatus(post.noiseReason || "filtered") : translateStatus(post.processingStatus);
          return '<article class="news-item"><div class="news-source"><i class="source-bullet ' + (post.isNoise ? "noise" : "") + '"></i><strong>' + escapeHtml(post.sourceName) + '</strong><small>@' + escapeHtml(post.username) + '</small><time>' + relativeTime(post.observedAt) + '</time></div><div class="news-content"><div class="news-meta">' + chip(status, post.isNoise ? "" : toneForStatus(post.processingStatus)) + chip(translateCategory(post.sourceCategory)) + '</div><h3>' + escapeHtml(post.originalText || "پست بدون متن") + '</h3><p>' + escapeHtml(post.normalizedText || "متن نرمال‌سازی‌شده موجود نیست") + '</p></div><div class="news-actions"><a class="external-link" target="_blank" rel="noreferrer" href="' + safeUrl(post.canonicalUrl) + '">بازکردن در تلگرام ↗</a></div></article>';
        }).join("");
      }
      function renderEvents(events, candidates) {
        var target = document.getElementById("event-list");
        if (!target) return;
        var candidateMap = {};
        candidates.forEach(function (candidate) { candidateMap[candidate.eventId + ":" + candidate.eventVersion] = candidate; });
        var filtered = events.filter(function (event) { return eventFilter === "all" || event.verificationStatus === eventFilter; });
        document.getElementById("events-count").textContent = toFaDigits(filtered.length) + " رویداد";
        if (!filtered.length) { target.innerHTML = '<div class="panel empty-state"><strong>رویدادی با این وضعیت پیدا نشد</strong><span>فیلتر دیگری را امتحان کنید.</span></div>'; return; }
        target.innerHTML = filtered.slice(0, 40).map(function (event) {
          var candidate = candidateMap[event.id + ":" + event.eventVersion];
          var candidateLabel = candidate ? translateStatus(candidate.decision) + " · " + translateStatus(candidate.status) : "بدون تصمیم تحریریه";
          return '<article class="event-card"><div class="event-score"><span>امتیاز اهمیت</span><strong>' + toFaDigits(event.importanceScore) + '</strong></div><div class="event-main"><div class="news-meta">' + chip(translateStatus(event.verificationStatus), toneForStatus(event.verificationStatus)) + chip(translateCategory(event.category)) + '</div><h3>' + escapeHtml(event.title) + '</h3><p>' + escapeHtml(event.coreFact) + '</p><div class="event-meta"><span>' + toFaDigits(event.sourceCount) + ' منبع</span><span>' + toFaDigits(event.independentConfirmations) + ' تأیید مستقل</span><span>نسخهٔ ' + toFaDigits(event.eventVersion) + '</span><span>آخرین تغییر ' + relativeTime(event.lastUpdatedAt) + '</span></div></div><div class="event-side">' + chip(candidateLabel, candidate && candidate.decision === "PUBLISH" ? "lime" : "") + (candidate ? '<small>امتیاز تحریریه: ' + toFaDigits(candidate.score) + '</small>' : '') + '</div></article>';
        }).join("");
      }
      function renderSources(sources) {
        var healthy = sources.filter(function (source) { return source.healthStatus === "healthy"; }).length;
        var pending = sources.filter(function (source) { return source.healthStatus === "pending_validation"; }).length;
        var attention = sources.length - healthy - pending;
        var healthGrid = document.getElementById("health-grid");
        if (healthGrid) healthGrid.innerHTML = '<div class="health-card success"><span>سالم</span><strong>' + toFaDigits(healthy) + '</strong></div><div class="health-card warning"><span>در انتظار بررسی</span><strong>' + toFaDigits(pending) + '</strong></div><div class="health-card danger"><span>نیازمند توجه</span><strong>' + toFaDigits(attention) + '</strong></div>';
        var target = document.getElementById("source-table");
        if (!target) return;
        if (!sources.length) { target.innerHTML = '<tr><td colspan="7" class="skeleton">هنوز منبعی ثبت نشده است.</td></tr>'; return; }
        target.innerHTML = sources.map(function (source) {
          var status = source.isActive ? source.healthStatus : "inactive";
          return '<tr><td><div class="source-cell"><i class="source-led ' + escapeHtml(source.healthStatus) + '"></i><div><strong>' + escapeHtml(source.name) + '</strong><div class="source-handle">@' + escapeHtml(source.username) + '</div></div></div></td><td>' + chip(translateStatus(status), toneForStatus(status)) + '</td><td>' + escapeHtml(translateCategory(source.category)) + '</td><td>' + chip(translatePriority(source.priorityTier)) + '</td><td>' + escapeHtml(formatTime(source.lastPolledAt)) + '</td><td>' + escapeHtml(source.lastSeenMessageId == null ? "—" : toFaDigits(source.lastSeenMessageId)) + '</td><td style="max-width:240px;color:var(--coral)">' + escapeHtml(source.lastError ? translateError(source.lastError) : "—") + '</td></tr>';
        }).join("");
      }
      function storyMarkup(story) {
        var tone = toneForStatus(story.publicationState);
        var error = story.lastError ? '<div style="margin-top:8px;color:var(--coral);font-size:10px">' + escapeHtml(translateError(story.lastError)) + '</div>' : '';
        return '<article class="story-item"><div><div class="story-meta">' + chip(translateStatus(story.publicationState), tone) + chip(translateStatus(story.verificationStatus), toneForStatus(story.verificationStatus)) + chip(translateCategory(story.category)) + '</div><h3>' + escapeHtml(story.title) + '</h3><p>' + escapeHtml(story.description) + '</p>' + error + '</div><div><div class="story-time">رویداد ' + toFaDigits(story.eventId) + ' · نسخهٔ ' + toFaDigits(story.eventVersion) + '</div><div class="story-time">' + escapeHtml(formatTime(story.publishedAt || story.createdAt)) + '</div>' + (story.telegramMessageId ? '<div class="story-time">شناسهٔ تلگرام: ' + toFaDigits(story.telegramMessageId) + '</div>' : '') + '</div></article>';
      }
      function renderStories(stories) {
        var target = document.getElementById("story-list");
        if (!target) return;
        var count = document.getElementById("publish-count");
        if (count) count.textContent = toFaDigits(stories.length) + " سابقه";
        target.innerHTML = stories.length ? stories.slice(0, 40).map(storyMarkup).join("") : '<div class="panel empty-state"><strong>هنوز خبری برای انتشار ثبت نشده است</strong><span>مواردی که از دروازهٔ تحریریه عبور کنند اینجا دیده می‌شوند.</span></div>';
      }
      function renderSystemDetails(data) {
        var target = document.getElementById("system-details");
        if (!target) return;
        var environment = data.system.environment === "production" ? "تولید" : data.system.environment;
        var enabled = Boolean(data.system.publishingEnabled);
        document.getElementById("system-mode").textContent = (enabled ? "انتشار فعال" : "انتشار متوقف") + " · " + environment;
        var publishTitle = document.getElementById("publishing-title");
        var publishHelp = document.getElementById("publishing-help");
        var publishToggle = document.getElementById("publishing-toggle");
        var publishToggleLabel = document.getElementById("publishing-toggle-label");
        if (publishTitle) publishTitle.textContent = enabled ? "انتشار فعال" : "انتشار متوقف";
        if (publishHelp) publishHelp.textContent = enabled ? "خبرهای عبورکرده از دروازهٔ تحریریه می‌توانند بدون تأخیر به تلگرام بروند." : "خبرها دریافت و تحلیل می‌شوند، اما به تلگرام ارسال نخواهند شد.";
        if (publishToggle) {
          publishToggle.classList.toggle("enabled", enabled);
          publishToggle.setAttribute("aria-pressed", String(enabled));
        }
        if (publishToggleLabel) publishToggleLabel.textContent = enabled ? "خاموش‌کردن" : "روشن‌کردن";
        var rows = [["محیط اجرا", environment], ["وضعیت انتشار", data.system.publishingEnabled ? "فعال" : "متوقف"], ["مقصد تلگرام", '<a class="destination" target="_blank" rel="noreferrer" href="' + safeUrl(data.system.destinationUrl) + '">' + escapeHtml(data.system.destinationUrl) + '</a>'], ["شناسهٔ مقصد", '<span dir="ltr">' + escapeHtml(data.system.destinationChatId) + '</span>'], ["آخرین دریافت", data.overview.latestPollAt ? relativeTime(data.overview.latestPollAt) : "هنوز انجام نشده"], ["رویدادهای امتیازدهی‌شده", toFaDigits(data.overview.eventsScored)], ["خطاهای صف امروز", toFaDigits(data.overview.queueFailures)]];
        target.innerHTML = rows.map(function (row) { return '<div class="ops-row"><span>' + row[0] + '</span><strong>' + row[1] + '</strong></div>'; }).join("");
      }
      function renderAi(data) {
        var target = document.getElementById("ai-list");
        if (!target) return;
        var rows = [['مجموع تماس‌ها', data.overview.aiCalls, ""], ['نورون‌های برآوردشده', data.overview.aiNeurons, ""]].concat(data.aiUsage.map(function (row) { return [translateStage(row.stage), row.calls, row.estimatedNeurons]; }));
        target.innerHTML = rows.map(function (row, index) { var value = index < 2 ? toFaDigits(row[1]) : toFaDigits(row[1]) + " تماس / " + toFaDigits(row[2]) + " نورون"; return '<div class="ops-row"><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(value) + '</strong></div>'; }).join("");
      }
      function bindFilters() {
        document.querySelectorAll("[data-news-filter]").forEach(function (button) { button.addEventListener("click", function () { newsFilter = button.getAttribute("data-news-filter"); document.querySelectorAll("[data-news-filter]").forEach(function (item) { item.classList.toggle("active", item === button); }); if (snapshot) renderNews(snapshot.posts); }); });
        document.querySelectorAll("[data-event-filter]").forEach(function (button) { button.addEventListener("click", function () { eventFilter = button.getAttribute("data-event-filter"); document.querySelectorAll("[data-event-filter]").forEach(function (item) { item.classList.toggle("active", item === button); }); if (snapshot) renderEvents(snapshot.events, snapshot.candidates); }); });
        var search = document.getElementById("news-search");
        if (search) { search.value = newsQuery; search.addEventListener("input", function () { newsQuery = search.value; if (snapshot) renderNews(snapshot.posts); }); }
      }
      function bindActionButtons() {
        var validate = document.getElementById("system-validate-button");
        var telegram = document.getElementById("system-telegram-button");
        var requeue = document.getElementById("system-requeue-button");
        var publishingToggle = document.getElementById("publishing-toggle");
        if (validate) validate.addEventListener("click", function () { action(validate, "/admin/api/actions/validate-sources"); });
        if (telegram) telegram.addEventListener("click", function () { action(telegram, "/admin/api/actions/verify-telegram", "GET"); });
        if (requeue) requeue.addEventListener("click", function () { action(requeue, "/admin/api/actions/requeue-pending"); });
        if (publishingToggle) publishingToggle.addEventListener("click", function () {
          if (!snapshot || !snapshot.system) return;
          var nextEnabled = !snapshot.system.publishingEnabled;
          var message = nextEnabled ? "انتشار تلگرام روشن شود؟ خبرهای واجد شرایط ممکن است بدون تأخیر منتشر شوند." : "انتشار تلگرام خاموش شود؟ خبرهای جدید ارسال نخواهند شد.";
          if (window.confirm(message)) action(publishingToggle, "/admin/api/actions/set-publishing", "POST", { enabled: nextEnabled });
        });
        var sourceValidate = document.getElementById("sources-validate-button");
        if (sourceValidate) sourceValidate.addEventListener("click", function () { action(sourceValidate, "/admin/api/actions/validate-sources"); });
      }
      async function request(path, options) {
        var response = await fetch(path, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {}));
        if (response.status === 401) { showLogin("نشست شما منقضی شده است. دوباره وارد شوید."); throw new Error("unauthorized"); }
        var payload = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(payload.error || "request_failed");
        return payload;
      }
      async function login(event) {
        event.preventDefault();
        loginError.textContent = "";
        var form = new URLSearchParams();
        form.set("username", document.getElementById("username").value);
        form.set("password", document.getElementById("password").value);
        try {
          await request("/admin/api/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
          document.getElementById("password").value = "";
          showApp();
          await loadSnapshot();
          startRefresh();
        } catch (error) { loginError.textContent = error.message === "unauthorized" ? "نام کاربری یا گذرواژه نادرست است." : "اطلاعات ورود پنل تنظیم نشده است."; }
      }
      async function logout() { await request("/admin/api/logout", { method: "POST" }).catch(function () {}); snapshot = null; navigate("pulse", true); showLogin(""); }
      async function loadSnapshot() {
        var refresh = document.getElementById("refresh-button");
        if (refresh) { refresh.disabled = true; refresh.textContent = "در حال دریافت…"; }
        try { render(await request("/admin/api/overview")); } catch (error) { if (error.message !== "unauthorized") showFlash("همگام‌سازی زنده ناموفق بود: " + translateError(error.message), true); } finally { if (refresh) { refresh.disabled = false; refresh.textContent = "به‌روزرسانی"; } }
      }
      function startRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = setInterval(loadSnapshot, 60000); }
      async function action(button, path, method, body) {
        button.disabled = true;
        var label = button.innerHTML;
        button.setAttribute("aria-busy", "true");
        button.innerHTML = "در حال اجرا…";
        var options = { method: method || "POST" };
        if (body !== undefined) { options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify(body); }
        try { await request(path, options); showFlash("اقدام با موفقیت انجام شد."); await loadSnapshot(); } catch (error) { showFlash(translateError(error.message), true); } finally { button.disabled = false; button.removeAttribute("aria-busy"); button.innerHTML = label; }
      }

      loginForm.addEventListener("submit", login);
      document.getElementById("logout-button").addEventListener("click", logout);
      document.getElementById("refresh-button").addEventListener("click", loadSnapshot);
      document.querySelectorAll("[data-route]").forEach(function (link) { link.addEventListener("click", function (event) { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); navigate(link.getAttribute("data-route")); }); });
      window.addEventListener("popstate", function () { updateChrome(); if (snapshot) render(snapshot); });
      updateChrome();
      request("/admin/api/overview").then(function (data) { render(data); startRefresh(); }).catch(function (error) { if (error.message !== "unauthorized") showLogin(""); });
    }());
  </script>
</body>
</html>`;
