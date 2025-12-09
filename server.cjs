// server.cjs — Render Service (Full & Fixed)

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const uploadToR2 = require("./upload-r2.cjs");

// --- 1. SETUP EXPRESS (PHẦN BẠN BỊ THIẾU) ---
const app = express();
app.use(bodyParser.json({ limit: "5mb" })); // Tăng limit lên 5mb cho an toàn

// --- 2. API KEY AUTH ---
const API_KEY = process.env.API_KEY || "";
app.use((req, res, next) => {
  if (!API_KEY) return next();
  
  // Chấp nhận key từ Header HOẶC Query URL
  const k = req.header("x-api-key") || req.query.api_key;

  if (k !== API_KEY) {
    console.log(`[AUTH FAIL] Client sent: '${k}'`);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

// --- 3. HEALTH CHECK ---
app.get("/", (_, res) => res.json({ ok: true, mode: "hybrid-template-final" }));

// --- 4. HANDLEBARS HELPERS ---
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("gt", (a, b) => a > b);
Handlebars.registerHelper("lt", (a, b) => a < b);
Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
Handlebars.registerHelper("ifEquals", function (a, b, opts) {
  return a == b ? opts.fn(this) : opts.inverse(this);
});

// --- 5. RENDER FUNCTION (HYBRID LOCAL/REMOTE) ---
// --- 🔥 CORE: NO-CACHE RENDER FUNCTION ---
async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    
    // 1. Ưu tiên tìm file Local
    const localPath = path.join(__dirname, "templates", file);
    try {
      src = await fs.readFile(localPath, "utf8");
      console.log(`[Template] ✅ Loaded LOCAL: ${file}`);
    } catch (err) {
      // 2. Nếu không có -> Tìm Online (GitHub)
      const baseUrl = process.env.TEMPLATE_BASE_URL || "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
      
      // 🔥 TRICK QUAN TRỌNG: Thêm ?t=timestamp để ép GitHub trả về file mới nhất
      const url = `${baseUrl}/${file}?t=${Date.now()}`;
      
      console.log(`[Template] Fetching FRESH (No-Cache): ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch template from GitHub (${response.status}): ${url}`);
      }
      src = await response.text();
      console.log(`[Template] ✅ Fetched REMOTE success.`);
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
    const height = opts.height || 1350;

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

// Route: Leaderboard
app.post("/render/leaderboard", async (req, res) => {
  try {
    const timestamp = Date.now();
    const filename = `daily-${req.body.name || "anon"}-${timestamp}`.replace(/\s+/g, "_");

    let templateName = req.body.template || "daily_leaderboard_v1";
    if (!templateName.endsWith(".hbs")) templateName += ".hbs";

    console.log(`[Render] Generating Leaderboard via ${templateName}...`);

    const width = req.body.width || 1080;
    const height = req.body.height || 1600;

    const base64 = await renderTemplate(templateName, req.body, { width, height });
    const imageUrl = await uploadToR2(base64, filename, "reports");
    
    res.json({ ok: true, image_url: imageUrl });
  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Route: Personal Card
app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();

    // 1. DATA MAPPING
    const context = {
        ...data,
        p_name: data.player?.name || data.p_name || "anon",
        p_weight: data.player?.stats?.current_weight || data.p_weight,
        p_change: data.player?.stats?.total_lost || data.p_change,
        player: data.player || {},
        stats: data.player?.stats || {},
        round: data.round_config || {}
    };

    // 2. CHỌN TEMPLATE
    // Nếu n8n gửi "personal-progress/template.hbs" -> dùng luôn
    let templateName = data.template_url || data.template || "personal_progress_v1.hbs";

    // 3. TẠO TÊN FILE AN TOÀN (Slugify)
    const cleanName = String(context.p_name)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim().replace(/\s+/g, "_");
        
    const filename = `personal-${cleanName}-${timestamp}`;

    console.log(`[Render] Generating Personal Card via ${templateName} for ${context.p_name}...`);

    const width = data.width || 1080;
    const height = data.height || 1350;

    // 4. RENDER & UPLOAD
    const base64 = await renderTemplate(templateName, context, { width, height });
    const imageUrl = await uploadToR2(base64, filename, "reports");
    
    console.log(`[Render] Success: ${imageUrl}`);
    
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- 7. START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ render-service on ${PORT}`));
