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
app.get("/", (_, res) => res.json({ ok: true, mode: "hybrid-template-final-v2" }));

// --- 4. HANDLEBARS HELPERS ---
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("gt", (a, b) => a > b);
Handlebars.registerHelper("lt", (a, b) => a < b);
Handlebars.registerHelper("includes", (arr, val) => Array.isArray(arr) && arr.includes(val));
Handlebars.registerHelper("ifEquals", function (a, b, opts) {
  return a == b ? opts.fn(this) : opts.inverse(this);
});

// --- 5. RENDER FUNCTION ---
async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    
    // Xử lý nếu file là URL full (tránh lỗi lặp đường dẫn)
    let fileNameClean = file;
    if (file.startsWith("http")) {
        // Nếu n8n lỡ gửi link full, ta chỉ lấy phần đuôi hoặc dùng luôn tùy logic
        // Ở đây giả định file là tên file hoặc relative path
        const parts = file.split('/');
        fileNameClean = parts[parts.length - 1]; // Fallback đơn giản
    }

    // 1. Ưu tiên tìm file Local
    const localPath = path.join(__dirname, "templates", fileNameClean);
    try {
      src = await fs.readFile(localPath, "utf8");
      console.log(`[Template] ✅ Loaded LOCAL: ${fileNameClean}`);
    } catch (err) {
      // 2. Tìm Online (GitHub)
      const baseUrl = process.env.TEMPLATE_BASE_URL || "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
      
      // Fix lỗi khai báo trùng biến 'url' ở code cũ
      // Xử lý link: Nếu file input đã là link http thì dùng luôn, nếu không thì ghép với base
      let finalUrl = "";
      if (file.startsWith("http")) {
          finalUrl = file; 
      } else {
          finalUrl = `${baseUrl}/${file}`;
      }
      
      // Thêm timestamp chống cache
      if (finalUrl.includes('?')) finalUrl += `&t=${Date.now()}`;
      else finalUrl += `?t=${Date.now()}`;
      
      console.log(`[Template] Fetching FRESH: ${finalUrl}`);
      
      const response = await fetch(finalUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch template (${response.status}): ${finalUrl}`);
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

// Route: Leaderboard (Giữ nguyên)
app.post("/render/leaderboard", async (req, res) => {
  try {
    const timestamp = Date.now();
    const filename = `daily-${req.body.name || "anon"}-${timestamp}`.replace(/\s+/g, "_");

    let templateName = req.body.template || "daily_leaderboard_v1.hbs";
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

// Route: Personal Card (🔥 CẬP NHẬT LOGIC MAPPING MỚI TẠI ĐÂY)
app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();

    // === 1. SUPER MAPPING (SQL V2 -> Template V1) ===
    const player = data.player || {};
    const stats = player.stats || {};
    const round = data.round_config || {};
    const grid = player.grid || [];

    // Helper format số
    const fmt = (n) => parseFloat(n || 0).toFixed(1).replace('.0', '');

    // Map Grid (Lưới 10 ngày) - Quan trọng để hiện số Gram
    const mappedGrid = grid.map(d => {
        let valDisplay = "";
        // Nếu đã log và có số liệu
        if (d.status === 'logged' && d.delta_from_start !== null && d.delta_from_start !== undefined) {
            const valGram = Math.round(d.delta_from_start * 1000);
            valDisplay = (valGram > 0 ? "+" : "") + valGram; // VD: +500 hoặc -300
        }
        return {
            ...d, 
            status: d.status,
            change: valDisplay, // Template V1 dùng biến này để hiện số
            value: valDisplay,
            is_today: (d.day === round.day_index)
        };
    });

    const context = {
        ...data,
        // Header Info
        p_name:     player.name || data.p_name || "Chiến Binh",
        team_name:  player.team || "Marathon",
        round_name: round.name || "Vòng 1",
        date_str:   new Date().toLocaleDateString('vi-VN'),

        // Big Stats (3 Ô To)
        p_start:    fmt(stats.start_weight),
        p_current:  fmt(stats.current_weight),
        p_change:   (stats.delta_weight > 0 ? "+" : "") + fmt(stats.delta_weight),

        // Grid
        days: mappedGrid,
        grid: mappedGrid,

        // Fallbacks
        player, stats, round
    };
    // ===============================================

    // Chọn Template (Ưu tiên n8n gửi sang)
    let templateName = data.template_url || data.template || "personal_progress_v1.hbs";

    // Tạo tên file sạch
    const cleanName = String(context.p_name)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim().replace(/\s+/g, "_");
    const filename = `personal-${cleanName}-${timestamp}`;

    console.log(`[Render] Generating via ${templateName} for ${context.p_name}...`);

    const width = data.width || 1080;
    const height = data.height || 1350;

    // Render & Upload (Dùng hàm uploadToR2 có sẵn của bạn)
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
