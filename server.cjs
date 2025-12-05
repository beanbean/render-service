// server.cjs — Render Service (Express + Handlebars + Puppeteer + Cloudflare R2 + Remote Template)

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const uploadToR2 = require("./upload-r2.cjs");

// --- Setup Express ---
const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// --- API KEY AUTH ---
const API_KEY = process.env.API_KEY || "";
app.use((req, res, next) => {
  if (!API_KEY) return next();
  // Chấp nhận key từ Header HOẶC Query URL
  const k = req.header("x-api-key") || req.query.api_key;

  console.log(`[AUTH] Client sent: '${k}' | Server expects: '${API_KEY}'`);

  if (k !== API_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

// --- Health Check ---
app.get("/", (_, res) => res.json({ ok: true, mode: "hybrid-template" }));

// --- Handlebars Helpers ---
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("gt", (a, b) => a > b); // Helper so sánh lớn hơn
Handlebars.registerHelper("lt", (a, b) => a < b); // Helper so sánh nhỏ hơn
Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
Handlebars.registerHelper("ifEquals", function (a, b, opts) {
  return a == b ? opts.fn(this) : opts.inverse(this);
});

// --- 🔥 CORE: HYBRID RENDER TEMPLATE FUNCTION ---
async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    
    // Bước 1: Ưu tiên tìm file Local (trong thư mục templates/)
    const localPath = path.join(__dirname, "templates", file);
    try {
      src = await fs.readFile(localPath, "utf8");
      console.log(`[Template] ✅ Loaded LOCAL: ${file}`);
    } catch (err) {
      // Bước 2: Nếu Local không có -> Tìm Online (Remote GitHub)
      // Lấy URL từ biến môi trường hoặc dùng mặc định link của bạn
      const baseUrl = process.env.TEMPLATE_BASE_URL || "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
      
const targetUrl = `${baseUrl}/${file}`; // Ghép chuỗi trước
console.log(`[DEBUG URL] Full URL to fetch: '${targetUrl}'`); // Log ra xem nó là cái gì

const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch template from GitHub: ${response.statusText}`);
      }
      src = await response.text();
      console.log(`[Template] ✅ Fetched & Using REMOTE content.`);
    }

    // --- Compile & Render (Giữ nguyên) ---
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

// --- Leaderboard API ---
app.post("/render/leaderboard", async (req, res) => {
  try {
    const timestamp = Date.now();
    const filename = `daily-${req.body.name || "anon"}-${timestamp}`.replace(/\s+/g, "_");

    console.log(`[Render] Generating leaderboard for ${req.body.name || "anon"}...`);
    
    // Lấy tên template động
    let templateName = req.body.template || "daily_leaderboard_v1";
    if (!templateName.endsWith(".hbs")) templateName += ".hbs";

    const base64 = await renderTemplate(templateName, req.body, {
      width: 1080,
      height: 1600,
    });

    console.log("[Upload] Uploading to R2...");
    const imageUrl = await uploadToR2(base64, filename, "reports");
    console.log("[Upload] Done:", imageUrl);

    res.json({ ok: true, image_url: imageUrl });
  } catch (e) {
    console.error("Error in /render/leaderboard:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Personal Card API ---
app.post("/render/personal", async (req, res) => {
  try {
    const timestamp = Date.now();
    const playerName = (req.body.player && req.body.player.name) ? req.body.player.name : (req.body.name || "anon");
    const filename = `personal-${playerName}-${timestamp}`.replace(/\s+/g, "_");

    console.log(`[Render] Generating personal card for ${playerName}...`);

    // Lấy tên template động
    let templateName = req.body.template || "personal_progress_v1";
    if (!templateName.endsWith(".hbs")) templateName += ".hbs";

    const base64 = await renderTemplate(templateName, req.body, {
      width: 1080,
      height: 1350,
    });

    console.log("[Upload] Uploading to R2...");
    const imageUrl = await uploadToR2(base64, filename, "reports");
    console.log("[Upload] Done:", imageUrl);

    res.json({ ok: true, image_url: imageUrl });
  } catch (e) {
    console.error("Error in /render/personal:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ render-service on ${PORT}`));
