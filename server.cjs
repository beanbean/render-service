const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const uploadToR2 = require("./upload-r2.cjs");

// --- 1. SETUP EXPRESS ---
const app = express();
app.use(bodyParser.json({ limit: "5mb" })); 

// --- 2. API KEY AUTH ---
const API_KEY = process.env.API_KEY || "";
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const k = req.header("x-api-key") || req.query.api_key;
  if (k !== API_KEY) {
    console.log(`[AUTH FAIL] Client sent: '${k}'`);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

// --- 3. HEALTH CHECK ---
app.get("/", (_, res) => res.json({ ok: true, mode: "leaderboard-ready-v4" }));

// --- 4. HANDLEBARS HELPERS ---
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("gt", (a, b) => a > b);
Handlebars.registerHelper("lt", (a, b) => a < b);
Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
Handlebars.registerHelper("ifEquals", function (a, b, opts) {
  return a == b ? opts.fn(this) : opts.inverse(this);
});
// 🔥 MỚI: Helper cộng số (Dùng cho Rank #1, #2...)
Handlebars.registerHelper("add", (a, b) => a + b);

// --- 5. RENDER FUNCTION ---
async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    
    let fileNameClean = file;
    if (file.startsWith("http")) {
        const parts = file.split('/');
        fileNameClean = parts[parts.length - 1];
    }

    // 1. Local
    const localPath = path.join(__dirname, "templates", fileNameClean);
    try {
      src = await fs.readFile(localPath, "utf8");
    } catch (err) {
      // 2. Remote
      const baseUrl = process.env.TEMPLATE_BASE_URL || "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
      let finalUrl = file.startsWith("http") ? file : `${baseUrl}/${file}`;
      finalUrl += (finalUrl.includes('?') ? '&' : '?') + `t=${Date.now()}`;
      
      console.log(`[Template] Fetching FRESH: ${finalUrl}`);
      const response = await fetch(finalUrl);
      if (!response.ok) throw new Error(`Failed to fetch template (${response.status})`);
      src = await response.text();
    }

    const tpl = Handlebars.compile(src);
    const html = tpl(data);

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    const width = opts.width || 1080;
    const height = opts.height || 1444; 

    await page.setViewport({ width, height });
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });
    await page.evaluateHandle("document.fonts.ready");

    const buf = await page.screenshot({ type: "png" });
    await browser.close();

    return buf.toString("base64");
  } catch (err) {
    console.error("Render error:", err);
    throw err;
  }
}

// --- 6. API ROUTES ---

// Route: Leaderboard (🔥 ĐÃ FIX: Nhận template_url từ n8n)
app.post("/render/leaderboard", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();
    const teamName = data.player?.team || "Team";
    
    // Tên file sạch
    const cleanName = String(teamName)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim().replace(/\s+/g, "_");
    const filename = `leaderboard-${cleanName}-${timestamp}`;

    // Ưu tiên template từ n8n gửi sang
    let templateName = data.template_url || "daily_leaderboard_v1.hbs";

    console.log(`[Render] Generating Leaderboard via ${templateName}...`);

    const width = data.width || 1080;
    const height = data.height || 1600;

    const base64 = await renderTemplate(templateName, data, { width, height });
    const imageUrl = await uploadToR2(base64, filename, "reports");
    
    console.log(`[Render] Success: ${imageUrl}`);
    res.json({ ok: true, image_url: imageUrl });
  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Route: Personal Card (GIỮ NGUYÊN CODE ĐÃ CHẠY ỔN CỦA BẠN)
app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();

    const p = data.player || {};
    const s = p.stats || {};
    const r = data.round_config || {};
    const g = p.grid || [];

    const fmt = (n) => (n !== null && n !== undefined ? parseFloat(n).toFixed(1).replace('.0', '') : null);

    // --- LOGIC CHECK HOÀN THÀNH ---
    const targetDay = parseInt(r.total_days || 10);
    const finalDayLog = g.find(d => parseInt(d.day) === targetDay);
    const isFinished = !!(finalDayLog && finalDayLog.status === 'logged');

    console.log(`[Logic Check] Player: ${p.name} | Finished: ${isFinished}`);

    const daysMapped = g.map(d => {
        let valGram = 0;
        let statusClass = d.status; 
        if (d.status === 'logged' && d.delta_from_start !== null) {
            valGram = Math.round(d.delta_from_start * 1000);
            if (valGram > 0) statusClass = 'gain';
            else if (valGram < 0) statusClass = 'loss';
            else statusClass = 'logged';
        }
        return {
            status: statusClass,
            value_g: valGram,
            label: `NGÀY ${d.day}`,
            leader: d.is_today ? "HÔM NAY" : null
        };
    });

    const context = {
        player: {
            name: p.name || "Chiến Binh",
            team: p.team || "Marathon",
            avatar: p.avatar,
            round_name: r.name || "Vòng 1",
            info_line: `Ngày ${r.day_index || 1}, ${new Date().toLocaleDateString('vi-VN')}`
        },
        stats: {
            start: fmt(s.start_weight),
            finish: isFinished ? fmt(s.current_weight) : null,
            result: isFinished ? fmt(s.delta_weight) : null,
            current_change: fmt(s.delta_weight)
        },
        days: daysMapped
    };

    let templateName = data.template_url || "personal_progress_v1.hbs";
    const cleanName = String(context.player.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");
    const filename = `personal-${cleanName}-${timestamp}`;

    const base64 = await renderTemplate(templateName, context, { width: 1080, height: 1444 });
    const imageUrl = await uploadToR2(base64, filename, "reports");
    
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- 7. START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ render-service on ${PORT}`));
