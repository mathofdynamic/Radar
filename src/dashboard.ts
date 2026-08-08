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
  <title>رادار / کنسول عملیات</title>
  <style>
    @font-face { font-family: "RadarPersian"; src: url("https://famjljl5gg.ufs.sh/f/aej4FOV7nKCWdXvwA03Yb9TX2i40Gw7yNtgknEQAPWJhYCO8") format("woff2"); font-style: normal; font-weight: 400 700; font-display: swap; }
    @font-face { font-family: "RadarPersian"; src: url("https://famjljl5gg.ufs.sh/f/aej4FOV7nKCWkhCK7UBlTIYdxai4rQEHcnsA2U9h6GjuS0OK") format("woff2"); font-style: normal; font-weight: 800 900; font-display: swap; }
    :root {
      color-scheme: dark;
      --bg: #0b0e12;
      --panel: #12171d;
      --panel-2: #182029;
      --line: #2b3641;
      --line-soft: rgba(207, 227, 232, .11);
      --text: #edf2f0;
      --muted: #8c9a9b;
      --faint: #536064;
      --primary: #6f8cff;
      --primary-soft: rgba(111, 140, 255, .12);
      --success: #78d6a5;
      --cyan: #8fe5f1;
      --amber: #f3bf70;
      --coral: #ff8e78;
      --shadow: 0 24px 80px rgba(0, 0, 0, .34);
      --radius: 16px;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-width: 320px;
      color: var(--text);
      background:
        radial-gradient(circle at 80% -10%, rgba(111, 140, 255, .12), transparent 34rem),
        radial-gradient(circle at 0% 40%, rgba(143, 229, 241, .045), transparent 30rem),
        linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
        var(--bg);
      background-size: auto, auto, 44px 44px, 44px 44px, auto;
      font-family: "RadarPersian";
      letter-spacing: 0;
      direction: rtl;
      text-align: right;
    }
    button, input { font: inherit; }
    button { cursor: pointer; }
    .hidden { display: none !important; }
    .login-shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; position: relative; overflow: hidden; }
    .login-shell::before { content: ""; position: absolute; width: 620px; height: 620px; border: 1px solid rgba(111,140,255,.2); border-radius: 50%; box-shadow: 0 0 0 52px rgba(111,140,255,.035), 0 0 0 104px rgba(111,140,255,.025), 0 0 0 156px rgba(111,140,255,.02); transform: translate(22%, -6%); }
    .login-shell::after { content: ""; position: absolute; width: 1px; height: 100vh; background: linear-gradient(transparent, rgba(111,140,255,.5), transparent); transform: rotate(42deg); opacity: .25; }
    .login-card { width: min(100%, 440px); padding: 42px; border: 1px solid var(--line); background: rgba(17,21,24,.88); box-shadow: var(--shadow); border-radius: 22px; position: relative; z-index: 1; backdrop-filter: blur(18px); animation: rise .65s cubic-bezier(.2,.8,.2,1) both; }
    .eyebrow { color: var(--primary); font: 600 11px/1.2 "RadarPersian"; letter-spacing: .03em; }
    .brand-mark { display: flex; align-items: center; gap: 12px; margin-bottom: 42px; }
    .radar-dot { width: 15px; height: 15px; display: inline-block; border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 6px rgba(111,140,255,.12), 0 0 28px rgba(111,140,255,.45); }
    .brand-name { font: 800 18px/1 "RadarPersian"; letter-spacing: .03em; }
    .login-card h1 { margin: 0 0 12px; font-size: clamp(32px, 6vw, 48px); line-height: .98; letter-spacing: -.055em; }
    .login-card p { color: var(--muted); line-height: 1.65; margin: 0 0 30px; }
    .field { display: grid; gap: 8px; margin: 16px 0; }
    .field label { color: var(--muted); font-size: 12px; }
    .field input { width: 100%; color: var(--text); background: #0b0f11; border: 1px solid var(--line); border-radius: 10px; padding: 13px 14px; outline: none; transition: border-color .2s, box-shadow .2s; }
    .field input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(111,140,255,.14); }
    .primary-button { border: 1px solid var(--primary); border-radius: 10px; background: var(--primary); color: #f7f9ff; font-weight: 700; padding: 13px 16px; width: 100%; margin-top: 18px; transition: transform .2s, box-shadow .2s, background .2s; }
    .primary-button:hover { transform: translateY(-2px); background: #829aff; box-shadow: 0 12px 30px rgba(111,140,255,.2); }
    .error-text { color: var(--coral); font-size: 13px; min-height: 20px; margin-top: 15px; }
    .app-shell { display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100vh; }
    .sidebar { position: sticky; top: 0; height: 100vh; padding: 28px 18px; border-left: 1px solid var(--line-soft); background: rgba(10,13,15,.82); display: flex; flex-direction: column; z-index: 4; }
    .sidebar .brand-mark { margin: 2px 12px 48px; }
    .nav-label { padding: 0 12px 12px; color: var(--faint); font: 600 10px/1 "RadarPersian"; }
    .nav { display: grid; gap: 5px; }
    .nav button { border: 1px solid transparent; border-radius: 10px; padding: 11px 12px; display: flex; gap: 12px; align-items: center; color: var(--muted); background: transparent; text-align: right; transition: .2s; }
    .nav button:hover, .nav button.active { color: var(--text); background: var(--panel-2); border-color: var(--line); }
    .nav button.active .nav-icon { color: var(--primary); }
    .nav-icon { width: 18px; text-align: center; color: var(--faint); font-size: 14px; }
    .sidebar-foot { margin-top: auto; padding: 14px 12px; border-top: 1px solid var(--line-soft); color: var(--faint); font: 10px/1.6 "RadarPersian"; }
    .main { width: 100%; max-width: 1560px; min-width: 0; padding: 0 34px 54px; }
    .topbar { position: sticky; top: 0; z-index: 3; height: 92px; display: flex; align-items: center; justify-content: space-between; gap: 18px; border-bottom: 1px solid var(--line-soft); margin-bottom: 34px; background: rgba(11,14,18,.86); backdrop-filter: blur(16px); }
    .topbar h2 { margin: 0; font-size: 22px; letter-spacing: -.03em; }
    .topbar-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .live-pill, .status-pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); border-radius: 99px; padding: 7px 10px; color: var(--muted); font: 10px "RadarPersian"; }
    .live-pill { color: var(--success); border-color: rgba(120,214,165,.28); background: rgba(120,214,165,.06); }
    .pulse { width: 7px; height: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 0 rgba(120,214,165,.7); animation: pulse 1.8s infinite; }
    .quiet-button, .outline-button { border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--muted); padding: 8px 11px; transition: .2s; }
    .quiet-button:hover, .outline-button:hover { color: var(--text); border-color: var(--muted); background: var(--panel-2); }
    .outline-button.danger:hover { color: var(--coral); border-color: var(--coral); }
    .section { scroll-margin-top: 24px; margin-bottom: 34px; animation: rise .55s cubic-bezier(.2,.8,.2,1) both; }
    .section:nth-of-type(2) { animation-delay: .04s; } .section:nth-of-type(3) { animation-delay: .08s; } .section:nth-of-type(4) { animation-delay: .12s; }
    .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
    .section-heading h3 { margin: 0; font-size: 15px; letter-spacing: -.01em; }
    .section-heading span { color: var(--faint); font: 10px "RadarPersian"; }
    .kpi-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
    .kpi { min-height: 126px; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(145deg, rgba(21,27,31,.94), rgba(13,17,19,.94)); position: relative; overflow: hidden; }
    .kpi::after { content: ""; position: absolute; width: 84px; height: 84px; border: 1px solid currentColor; opacity: .09; border-radius: 50%; left: -25px; bottom: -30px; }
    .kpi-label { color: var(--muted); font-size: 11px; }
    .kpi-value { margin-top: 14px; color: var(--text); font: 800 clamp(27px, 3vw, 38px)/1 "RadarPersian"; }
    .kpi-note { margin-top: 10px; color: var(--faint); font-size: 10px; }
    .kpi.lime { color: var(--success); } .kpi.cyan { color: var(--cyan); } .kpi.amber { color: var(--amber); } .kpi.coral { color: var(--coral); }
    .grid-two { display: grid; grid-template-columns: minmax(0, 1.22fr) minmax(340px, .78fr); gap: 14px; }
    .panel { min-width: 0; border: 1px solid var(--line); border-radius: var(--radius); background: rgba(17,21,24,.82); box-shadow: 0 8px 34px rgba(0,0,0,.11); overflow: hidden; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 18px; border-bottom: 1px solid var(--line-soft); }
    .panel-head h4 { margin: 0; font-size: 13px; }
    .panel-head small { color: var(--faint); font: 10px "RadarPersian"; }
    .activity-list { max-height: 510px; overflow: auto; padding: 4px 18px 15px; }
    .activity-item { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--line-soft); }
    .activity-item:last-child { border-bottom: 0; }
    .activity-beacon { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: var(--muted); box-shadow: 0 0 0 4px rgba(140,154,155,.08); }
    .activity-beacon.lime { background: var(--success); box-shadow: 0 0 0 4px rgba(120,214,165,.1); } .activity-beacon.cyan { background: var(--cyan); box-shadow: 0 0 0 4px rgba(143,229,241,.1); } .activity-beacon.amber { background: var(--amber); box-shadow: 0 0 0 4px rgba(243,191,112,.1); } .activity-beacon.coral { background: var(--coral); box-shadow: 0 0 0 4px rgba(255,142,120,.1); }
    .activity-title { font-size: 12px; font-weight: 600; line-height: 1.35; }
    .activity-detail { color: var(--muted); font-size: 11px; line-height: 1.55; margin-top: 4px; }
    .activity-time { color: var(--faint); font: 9px "RadarPersian"; white-space: nowrap; }
    .ops-list { padding: 12px 18px 16px; display: grid; gap: 13px; }
    .ops-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; color: var(--muted); font-size: 11px; }
    .ops-row strong { color: var(--text); font: 700 12px "RadarPersian"; }
    .progress { height: 5px; border-radius: 99px; overflow: hidden; background: #20282c; margin-top: 8px; }
    .progress i { display: block; height: 100%; background: var(--primary); border-radius: inherit; }
    .table-wrap { overflow: auto; }
    table { border-collapse: collapse; width: 100%; min-width: 680px; }
    th, td { padding: 12px 16px; text-align: right; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
    th { color: var(--faint); font: 600 10px "RadarPersian"; white-space: nowrap; }
    td { color: var(--muted); font-size: 11px; }
    td strong { color: var(--text); font-weight: 600; }
    .source-name { display: flex; align-items: center; gap: 9px; color: var(--text); }
    .source-led { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); flex: 0 0 auto; }
    .source-led.healthy { background: var(--success); box-shadow: 0 0 9px rgba(120,214,165,.45); }
    .source-led.invalid, .source-led.degraded { background: var(--coral); }
    .source-led.pending_validation { background: var(--amber); }
    .chip { display: inline-flex; align-items: center; border-radius: 99px; padding: 4px 7px; border: 1px solid var(--line); color: var(--muted); font: 9px "RadarPersian"; white-space: nowrap; }
    .chip.lime { color: var(--success); border-color: rgba(120,214,165,.25); background: rgba(120,214,165,.06); }
    .chip.cyan { color: var(--cyan); border-color: rgba(143,229,241,.25); background: rgba(143,229,241,.06); }
    .chip.amber { color: var(--amber); border-color: rgba(243,191,112,.25); background: rgba(243,191,112,.06); }
    .chip.coral { color: var(--coral); border-color: rgba(255,142,120,.25); background: rgba(255,142,120,.06); }
    .news-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .news-card { border: 1px solid var(--line); border-radius: 14px; padding: 16px; background: linear-gradient(145deg, rgba(21,27,31,.84), rgba(13,17,19,.84)); transition: transform .2s, border-color .2s; }
    .news-card:hover { transform: translateY(-2px); border-color: #4a5b61; }
    .news-meta { display: flex; justify-content: space-between; gap: 10px; color: var(--faint); font: 9px "RadarPersian"; }
    .news-card h4 { font-size: 15px; line-height: 1.35; margin: 13px 0 9px; direction: rtl; text-align: right; }
    .news-card p { color: var(--muted); direction: rtl; text-align: right; font-size: 12px; line-height: 1.7; margin: 0 0 14px; }
    .news-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .external-link { color: var(--cyan); text-decoration: none; font: 10px "RadarPersian"; }
    .external-link:hover { text-decoration: underline; }
    .event-list { display: grid; gap: 8px; padding: 12px; }
    .event-row { display: grid; grid-template-columns: 74px minmax(0,1fr) auto; gap: 14px; align-items: center; border: 1px solid var(--line-soft); border-radius: 11px; padding: 13px; }
    .event-score { color: var(--primary); font: 800 22px "RadarPersian"; }
    .event-row h4 { margin: 0 0 4px; font-size: 12px; line-height: 1.4; }
    .event-row p { margin: 0; color: var(--muted); font-size: 11px; }
    .action-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .action-bar .outline-button { font-size: 11px; }
    .flash { position: fixed; left: 22px; bottom: 22px; max-width: 350px; z-index: 10; padding: 13px 15px; border: 1px solid var(--line); border-radius: 11px; background: #182126; color: var(--text); box-shadow: var(--shadow); font-size: 12px; transform: translateY(20px); opacity: 0; pointer-events: none; transition: .25s; }
    .flash.show { transform: translateY(0); opacity: 1; }
    .flash.error { border-color: rgba(255,142,120,.45); color: var(--coral); }
    .skeleton { color: var(--faint); padding: 34px 18px; text-align: center; font: 11px "RadarPersian"; }
    @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(120,214,165,.5); } 50% { box-shadow: 0 0 0 7px rgba(120,214,165,0); } }
    @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 1180px) { .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } .grid-two { grid-template-columns: 1fr; } }
    @media (max-width: 820px) { .app-shell { display: block; } .sidebar { position: sticky; height: auto; padding: 13px 16px; border-left: 0; border-bottom: 1px solid var(--line-soft); } .sidebar .brand-mark { margin: 2px 4px 14px; } .sidebar-foot, .nav-label { display: none; } .nav { display: flex; overflow: auto; gap: 6px; } .nav button { white-space: nowrap; padding: 8px 10px; } .main { padding: 0 16px 36px; } .topbar { height: auto; min-height: 82px; margin-bottom: 25px; } .topbar h2 { font-size: 18px; } .topbar-meta { gap: 6px; } .news-grid { grid-template-columns: 1fr; } }
    @media (max-width: 520px) { .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpi { min-height: 110px; padding: 14px; } .kpi-value { font-size: 25px; } .topbar { align-items: flex-start; padding: 18px 0; flex-direction: column; } .topbar-meta { justify-content: flex-start; } .login-card { padding: 30px 24px; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
  </style>
</head>
<body>
  <section id="login-view" class="login-shell">
    <form id="login-form" class="login-card">
      <div class="brand-mark"><span class="radar-dot"></span><span class="brand-name">رادار</span></div>
      <div class="eyebrow">اتاق عملیات خصوصی</div>
      <h1>نبض خبر را ببینید.</h1>
      <p>گردآوری، شواهد، راستی‌آزمایی، تصمیم‌های تحریریه و انتشار را در یک اتاق کنترل زنده زیر نظر بگیرید.</p>
      <div class="field"><label for="username">نام کاربری</label><input id="username" name="username" autocomplete="username" required /></div>
      <div class="field"><label for="password">گذرواژه</label><input id="password" name="password" type="password" autocomplete="current-password" required /></div>
      <button class="primary-button" type="submit">ورود به اتاق عملیات</button>
      <div id="login-error" class="error-text" role="alert"></div>
    </form>
  </section>

  <div id="app-view" class="app-shell hidden">
    <aside class="sidebar">
      <div class="brand-mark"><span class="radar-dot"></span><span class="brand-name">رادار</span></div>
      <div class="nav-label">اتاق کنترل</div>
      <nav class="nav">
        <button class="active" data-scroll="pulse"><span class="nav-icon">◉</span>نبض</button>
        <button data-scroll="news"><span class="nav-icon">↗</span>ورودی خبر</button>
        <button data-scroll="events"><span class="nav-icon">◎</span>رویدادها</button>
        <button data-scroll="sources"><span class="nav-icon">⌁</span>منابع</button>
        <button data-scroll="system"><span class="nav-icon">▦</span>سامانه</button>
      </nav>
      <div class="sidebar-foot">نسخه ابری / گردآوری دوره‌ای<br />هوشمندی اخبار فارسی</div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div><div class="eyebrow">رادار / عملیات</div><h2>فعالیت سامانه</h2></div>
        <div class="topbar-meta"><span id="live-status" class="live-pill"><i class="pulse"></i> زنده / ۶۰ ثانیه</span><span id="last-updated" class="status-pill">در انتظار همگام‌سازی</span><button id="refresh-button" class="quiet-button">به‌روزرسانی</button><button id="logout-button" class="quiet-button">خروج</button></div>
      </header>

      <section id="pulse" class="section">
        <div class="section-heading"><h3>نبض</h3><span id="system-line">در انتظار نخستین دریافت</span></div>
        <div class="kpi-grid">
          <article class="kpi lime"><div class="kpi-label">منابع فعال</div><div id="kpi-sources" class="kpi-value">—</div><div id="kpi-sources-note" class="kpi-note">—</div></article>
          <article class="kpi cyan"><div class="kpi-label">خبرهای دیده‌شده</div><div id="kpi-posts" class="kpi-value">—</div><div class="kpi-note">امروز / شمارنده‌های پایگاه داده</div></article>
          <article class="kpi amber"><div class="kpi-label">رویدادهای شکل‌گرفته</div><div id="kpi-events" class="kpi-value">—</div><div class="kpi-note">هوشمندی خوشه‌بندی‌شده</div></article>
          <article class="kpi lime"><div class="kpi-label">خبرهای منتشرشده</div><div id="kpi-stories" class="kpi-value">—</div><div class="kpi-note">رابط ربات تلگرام</div></article>
          <article class="kpi coral"><div class="kpi-label">خطاهای سامانه</div><div id="kpi-failures" class="kpi-value">—</div><div class="kpi-note">خطاهای صف امروز</div></article>
        </div>
      </section>

      <section class="section grid-two">
        <article class="panel"><div class="panel-head"><h4>جریان فعالیت زنده</h4><small id="activity-count">—</small></div><div id="activity-list" class="activity-list"><div class="skeleton">در حال اتصال به جریان فعالیت پایگاه داده…</div></div></article>
        <article id="system" class="panel"><div class="panel-head"><h4>نبض سامانه</h4><small id="environment-label">—</small></div><div id="system-list" class="ops-list"><div class="skeleton">در انتظار داده‌های سامانه…</div></div><div class="panel-head"><h4>اقدام‌های اپراتور</h4></div><div class="ops-list action-bar"><button id="validate-button" class="outline-button">اعتبارسنجی منابع</button><button id="telegram-button" class="outline-button">بررسی تلگرام</button><button id="requeue-button" class="outline-button">ارسال دوباره موارد در انتظار</button></div></article>
      </section>

      <section id="news" class="section"><div class="section-heading"><h3>ورودی خبر</h3><span>آخرین پست‌های عمومی دریافت‌شده از تلگرام</span></div><div id="news-grid" class="news-grid"><div class="panel skeleton">هنوز خبری دریافت نشده است.</div></div></section>

      <section id="events" class="section"><div class="section-heading"><h3>هوشمندی رویداد</h3><span>راستی‌آزمایی / اهمیت / وضعیت تحریریه</span></div><div class="panel"><div id="event-list" class="event-list"><div class="skeleton">هنوز رویدادی شکل نگرفته است.</div></div></div></section>

      <section id="sources" class="section"><div class="section-heading"><h3>دفتر منابع</h3><span>سلامت و مکان‌نماهای دریافت</span></div><div class="panel table-wrap"><table><thead><tr><th>منبع</th><th>وضعیت</th><th>اولویت</th><th>آخرین دریافت</th><th>مکان‌نما</th><th>آخرین خطا</th></tr></thead><tbody id="source-table"><tr><td colspan="6" class="skeleton">هنوز منبعی ثبت نشده است.</td></tr></tbody></table></div></section>

      <section class="section grid-two"><article class="panel"><div class="panel-head"><h4>خبرهای منتشرشده</h4><small>موارد نهایی ثبت‌شده</small></div><div class="table-wrap"><table><thead><tr><th>خبر</th><th>وضعیت</th><th>راستی‌آزمایی</th><th>زمان انتشار</th></tr></thead><tbody id="story-table"><tr><td colspan="4" class="skeleton">هنوز خبری منتشر نشده است.</td></tr></tbody></table></div></article><article class="panel"><div class="panel-head"><h4>بودجه هوش مصنوعی و تحریریه</h4><small>امروز</small></div><div id="ai-list" class="ops-list"><div class="skeleton">هنوز مصرف هوش مصنوعی ثبت نشده است.</div></div></article></section>

      <footer class="section" style="margin-top: 50px; color: var(--faint); font: 10px 'RadarPersian';">رادار / عملیات داخلی / به‌روزرسانی یک‌دقیقه‌ای / پایگاه داده مرجع اصلی</footer>
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
      var flash = document.getElementById("flash");
      var refreshTimer = null;
      var flashTimer = null;

      function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]; });
      }
      function safeUrl(value) {
        try { var parsed = new URL(value); return parsed.protocol === "https:" ? escapeHtml(parsed.href) : "#"; } catch (_) { return "#"; }
      }
      function toFaDigits(value) { return String(value == null ? "" : value).replace(/[0-9]/g, function (digit) { return "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]; }); }
      function translateStatus(value) {
        var labels = { CONFIRMED: "تأییدشده", DEVELOPING: "در حال شکل‌گیری", DISPUTED: "مورد اختلاف", UNVERIFIED: "تأییدنشده", PUBLISH: "انتشار", MONITOR: "پایش", IGNORE: "نادیده‌گرفتن", queued: "در صف", pending: "در انتظار", processing: "در حال انتشار", failed: "ناموفق", published: "منتشرشده", processed: "پردازش‌شده", noise: "نویز", filtered: "فیلترشده", healthy: "سالم", degraded: "تنزل‌یافته", invalid: "نامعتبر", inactive: "غیرفعال", pending_validation: "در انتظار اعتبارسنجی" };
        return labels[value] || value || "—";
      }
      function translatePriority(value) {
        var labels = { TIER_1: "اولویت ۱", TIER_2: "اولویت ۲", TIER_3: "اولویت ۳" };
        return labels[value] || value || "—";
      }
      function translateStage(value) {
        var labels = { embedding: "بردارسازی", stage1: "تحلیل اولیه", stage2: "بررسی تحریریه", cover: "تصویر خبری", editorial: "تحریریه" };
        return labels[value] || value || "—";
      }
      function translateCategory(value) {
        var labels = { politics: "سیاست", economy: "اقتصاد", security: "امنیت", technology: "فناوری", society: "جامعه", international: "بین‌الملل", market: "بازار", other: "سایر" };
        return labels[value] || value || "—";
      }
      function translateError(value) {
        var text = String(value || "");
        var labels = { unauthorized: "نشست شما منقضی شده است.", request_failed: "درخواست ناموفق بود.", dashboard_credentials_not_configured: "اطلاعات ورود پنل تنظیم نشده است.", no_public_posts: "پست عمومی پیدا نشد.", validation_failed: "اعتبارسنجی ناموفق بود.", unknown: "خطای نامشخص" };
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
        var seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
        if (seconds < 60) return seconds < 5 ? "همین حالا" : toFaDigits(seconds) + " ثانیه پیش";
        if (seconds < 3600) return toFaDigits(Math.floor(seconds / 60)) + " دقیقه پیش";
        if (seconds < 86400) return toFaDigits(Math.floor(seconds / 3600)) + " ساعت پیش";
        return toFaDigits(Math.floor(seconds / 86400)) + " روز پیش";
      }
      function chip(text, tone) { return '<span class="chip ' + (tone || "") + '">' + escapeHtml(text) + '</span>'; }
      function showFlash(message, isError) {
        flash.textContent = message;
        flash.className = "flash show" + (isError ? " error" : "");
        clearTimeout(flashTimer);
        flashTimer = setTimeout(function () { flash.className = "flash"; }, 4500);
      }
      function showLogin(message) {
        appView.classList.add("hidden");
        loginView.classList.remove("hidden");
        loginError.textContent = message || "";
        if (refreshTimer) clearInterval(refreshTimer);
      }
      function showApp() { loginView.classList.add("hidden"); appView.classList.remove("hidden"); }
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
      async function logout() { await request("/admin/api/logout", { method: "POST" }).catch(function () {}); showLogin(""); }
      async function loadSnapshot() {
        try { var data = await request("/admin/api/overview"); render(data); } catch (error) { if (error.message !== "unauthorized") showFlash("همگام‌سازی زنده ناموفق بود: " + translateError(error.message), true); }
      }
      function startRefresh() { if (refreshTimer) clearInterval(refreshTimer); refreshTimer = setInterval(loadSnapshot, 60000); }
      function render(data) {
        showApp();
        var overview = data.overview;
        document.getElementById("kpi-sources").textContent = overview.sourcesActive + "/" + overview.sourcesTotal;
        document.getElementById("kpi-sources-note").textContent = toFaDigits(overview.sourcesDegraded) + " منبع ناسالم یا نامعتبر";
        document.getElementById("kpi-posts").textContent = overview.postsObserved;
        document.getElementById("kpi-events").textContent = overview.eventsCreated;
        document.getElementById("kpi-stories").textContent = overview.storiesPublished;
        document.getElementById("kpi-failures").textContent = overview.queueFailures;
        document.getElementById("last-updated").textContent = "همگام‌شده " + relativeTime(data.generatedAt);
        var environment = data.system.environment === "production" ? "تولید" : data.system.environment === "staging" ? "آزمایشی" : data.system.environment;
        document.getElementById("system-line").textContent = data.system.publishingEnabled ? "انتشار فعال · محیط " + environment : "انتشار متوقف · محیط " + environment;
        document.getElementById("environment-label").textContent = "محیط " + environment + " / " + (data.system.publishingEnabled ? "زنده" : "متوقف");
        document.getElementById("activity-count").textContent = toFaDigits(data.activity.length) + " رخداد";
        renderActivity(data.activity);
        renderSystem(data);
        renderNews(data.posts);
        renderEvents(data.events, data.candidates);
        renderSources(data.sources);
        renderStories(data.stories);
        renderAi(data);
      }
      function renderActivity(items) {
        var target = document.getElementById("activity-list");
        if (!items.length) { target.innerHTML = '<div class="skeleton">هنوز فعالیتی ثبت نشده است.</div>'; return; }
        target.innerHTML = items.map(function (item) { return '<div class="activity-item"><i class="activity-beacon ' + item.tone + '"></i><div><div class="activity-title">' + escapeHtml(localizeActivityTitle(item.title)) + '</div><div class="activity-detail">' + escapeHtml(localizeActivityDetail(item.detail)) + (item.url ? ' · <a class="external-link" target="_blank" rel="noreferrer" href="' + safeUrl(item.url) + '">مشاهده منبع</a>' : '') + '</div></div><time class="activity-time">' + relativeTime(item.timestamp) + '</time></div>'; }).join("");
      }
      function renderSystem(data) {
        var o = data.overview;
        var rows = [
          ["مقصد انتشار", data.system.destinationUrl, ""],
          ["آخرین دریافت", data.overview.latestPollAt ? relativeTime(data.overview.latestPollAt) : "هنوز انجام نشده", ""],
          ["پست‌های خام ثبت‌شده", toFaDigits(o.rawPostsPersisted), ""],
          ["پاکت‌های دریافت‌شده در صف", toFaDigits(o.pollEnvelopesQueued), ""],
          ["تماس‌های هوش مصنوعی / نورون‌ها", toFaDigits(o.aiCalls) + " / " + toFaDigits(o.aiNeurons), ""]
        ];
        document.getElementById("system-list").innerHTML = rows.map(function (row) { return '<div class="ops-row"><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(row[1]) + '</strong></div>'; }).join("");
      }
      function renderNews(posts) {
        var target = document.getElementById("news-grid");
        if (!posts.length) { target.innerHTML = '<div class="panel skeleton">هنوز پستی دریافت نشده است.</div>'; return; }
        target.innerHTML = posts.slice(0, 20).map(function (post) { var statusTone = post.isNoise ? "" : post.processingStatus === "processed" ? "lime" : "cyan"; var status = post.isNoise ? "نویز / " + translateStatus(post.noiseReason || "filtered") : translateStatus(post.processingStatus); return '<article class="news-card"><div class="news-meta"><span>' + escapeHtml(post.sourceName) + '</span><span>' + relativeTime(post.observedAt) + '</span></div><h4>' + escapeHtml(post.originalText || "پست بدون متن") + '</h4><p>' + escapeHtml(post.normalizedText || "متن نرمال‌سازی‌شده موجود نیست") + '</p><div class="news-foot">' + chip(status, statusTone) + '<a class="external-link" target="_blank" rel="noreferrer" href="' + safeUrl(post.canonicalUrl) + '">تلگرام ↗</a></div></article>'; }).join("");
      }
      function renderEvents(events, candidates) {
        var target = document.getElementById("event-list");
        if (!events.length) { target.innerHTML = '<div class="skeleton">هنوز رویدادی شکل نگرفته است.</div>'; return; }
        var candidateMap = {}; candidates.forEach(function (candidate) { candidateMap[candidate.eventId + ":" + candidate.eventVersion] = candidate; });
        target.innerHTML = events.slice(0, 30).map(function (event) { var candidate = candidateMap[event.id + ":" + event.eventVersion]; var tone = event.verificationStatus === "CONFIRMED" ? "lime" : event.verificationStatus === "DISPUTED" ? "coral" : "amber"; var candidateLabel = candidate ? translateStatus(candidate.decision) + " · " + translateStatus(candidate.status) : ""; return '<div class="event-row"><div class="event-score">' + toFaDigits(event.importanceScore) + '</div><div><h4>' + escapeHtml(event.title) + '</h4><p>' + escapeHtml(event.coreFact) + '</p></div><div>' + chip(translateStatus(event.verificationStatus), tone) + '<br />' + (candidate ? chip(candidateLabel, candidate.decision === "PUBLISH" ? "lime" : "") : '') + '</div></div>'; }).join("");
      }
      function renderSources(sources) {
        var target = document.getElementById("source-table");
        if (!sources.length) { target.innerHTML = '<tr><td colspan="6" class="skeleton">هنوز منبعی ثبت نشده است.</td></tr>'; return; }
        target.innerHTML = sources.map(function (source) { var statusTone = source.healthStatus === "healthy" ? "lime" : source.healthStatus === "invalid" || source.healthStatus === "degraded" ? "coral" : "amber"; var status = source.isActive ? source.healthStatus : "inactive"; return '<tr><td><div class="source-name"><i class="source-led ' + escapeHtml(source.healthStatus) + '"></i><strong>' + escapeHtml(source.name) + '</strong></div><div style="margin-top:4px;color:var(--faint);font:10px RadarPersian;direction:ltr;text-align:right">@' + escapeHtml(source.username) + '</div></td><td>' + chip(translateStatus(status), statusTone) + '</td><td>' + chip(translatePriority(source.priorityTier)) + '</td><td>' + escapeHtml(formatTime(source.lastPolledAt)) + '</td><td>' + escapeHtml(source.lastSeenMessageId == null ? "—" : toFaDigits(source.lastSeenMessageId)) + '</td><td style="max-width:240px;color:var(--coral)">' + escapeHtml(source.lastError ? translateError(source.lastError) : "—") + '</td></tr>'; }).join("");
      }
      function renderStories(stories) {
        var target = document.getElementById("story-table");
        if (!stories.length) { target.innerHTML = '<tr><td colspan="4" class="skeleton">هنوز خبری منتشر نشده است.</td></tr>'; return; }
        target.innerHTML = stories.map(function (story) { var tone = story.publicationState === "published" ? "lime" : story.publicationState === "failed" ? "coral" : story.publicationState === "processing" ? "cyan" : "amber"; var error = story.lastError ? '<div style="margin-top:6px;color:var(--coral);font-size:10px">' + escapeHtml(translateError(story.lastError)) + '</div>' : ''; return '<tr><td><strong dir="rtl">' + escapeHtml(story.title) + '</strong><div style="margin-top:5px;color:var(--faint)">' + escapeHtml(translateCategory(story.category)) + ' · رویداد ' + toFaDigits(story.eventId) + '</div>' + error + '</td><td>' + chip(translateStatus(story.publicationState), tone) + '</td><td>' + chip(translateStatus(story.verificationStatus), story.verificationStatus === "CONFIRMED" ? "lime" : "amber") + '</td><td>' + escapeHtml(formatTime(story.publishedAt || story.createdAt)) + '</td></tr>'; }).join("");
      }
      function renderAi(data) {
        var target = document.getElementById("ai-list");
        var lines = [['مجموع تماس‌ها', toFaDigits(data.overview.aiCalls)], ['نورون‌های برآوردشده', toFaDigits(data.overview.aiNeurons)]].concat(data.aiUsage.map(function (row) { return [translateStage(row.stage), toFaDigits(row.calls) + " تماس / " + toFaDigits(row.estimatedNeurons) + " نورون"]; }));
        target.innerHTML = lines.map(function (line) { return '<div class="ops-row"><span>' + escapeHtml(line[0]) + '</span><strong>' + escapeHtml(line[1]) + '</strong></div>'; }).join("");
      }
      async function action(path, method) { try { var result = await request(path, { method: method || "POST" }); showFlash(result.ok === false ? "اقدام ناموفق بود." : "اقدام با موفقیت انجام شد."); await loadSnapshot(); } catch (error) { showFlash(translateError(error.message), true); } }
      loginForm.addEventListener("submit", login);
      document.getElementById("logout-button").addEventListener("click", logout);
      document.getElementById("refresh-button").addEventListener("click", loadSnapshot);
      document.getElementById("validate-button").addEventListener("click", function () { action("/admin/api/actions/validate-sources"); });
      document.getElementById("telegram-button").addEventListener("click", function () { action("/admin/api/actions/verify-telegram", "GET"); });
      document.getElementById("requeue-button").addEventListener("click", function () { action("/admin/api/actions/requeue-pending"); });
      document.querySelectorAll("[data-scroll]").forEach(function (button) { button.addEventListener("click", function () { var target = document.getElementById(button.getAttribute("data-scroll")); if (target) target.scrollIntoView({ behavior: "smooth" }); document.querySelectorAll(".nav button").forEach(function (item) { item.classList.remove("active"); }); button.classList.add("active"); }); });
      request("/admin/api/overview").then(function (data) { render(data); startRefresh(); }).catch(function (error) { if (error.message !== "unauthorized") showLogin(""); });
    }());
  </script>
</body>
</html>`;
