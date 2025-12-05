// server.cjs — Render Service (Express + Handlebars + Puppeteer + Cloudflare R2)

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const uploadToR2 = require("./upload-r2.cjs"); // 🔹 moved lên đầu để dễ debug

// --- Setup Express ---
const app = express();
app.use(bodyParser.json({ limit: "2mb" }));

// --- API KEY ---
const API_KEY = process.env.API_KEY || "";
app.use((req, res, next) => {
  if (!API_KEY) return next(); // nếu chưa set API_KEY thì bỏ qua check
  // Ưu tiên Header, nếu không có thì tìm trong Query (?api_key=...)
  const k = req.header("x-api-key") || req.query.api_key;

  console.log(`[AUTH DEBUG] Client sent: '${k}' | Server expects: '${API_KEY}'`);

  if (k !== API_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  
  next();
});

// --- Health Check ---
app.get("/", (_, res) => res.json({ ok: true }));

// --- Handlebars Helpers ---
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
Handlebars.registerHelper("ifEquals", function (a, b, opts) {
  return a == b ? opts.fn(this) : opts.inverse(this);
});

// --- Render Template Function ---
async function renderTemplate(file, data, opts = {}) {
  try {
    const tplPath = path.join(__dirname, "templates", file);
    const src = await fs.readFile(tplPath, "utf8");
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
    const base64 = await renderTemplate("daily-leader.hbs", req.body, {
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
    
    // Lấy tên người chơi để đặt tên file ảnh (Ưu tiên cấu trúc mới: player.name)
    const playerName = (req.body.player && req.body.player.name) ? req.body.player.name : (req.body.name || "anon");
    
    // Tạo tên file an toàn (bỏ dấu cách)
    const filename = `personal-${playerName}-${timestamp}`.replace(/\s+/g, "_");

    console.log(`[Render] Generating personal card for ${playerName}...`);

    // 🔥 LOGIC CHỌN TEMPLATE ĐỘNG (DYNAMIC TEMPLATE)
    // 1. Lấy tên template từ JSON (SQL gửi lên), nếu không có thì dùng mặc định 'personal_progress_v1'
    let templateName = req.body.template || "personal_progress_v1";
    
    // 2. Đảm bảo có đuôi .hbs
    if (!templateName.endsWith(".hbs")) {
      templateName += ".hbs";
    }

    console.log(`[Render] Using template file: ${templateName}`);

    // 3. Render
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
    // In rõ lỗi để dễ debug (ví dụ nếu không tìm thấy file template)
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ render-service on ${PORT}`));
