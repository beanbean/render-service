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
// Route: Personal Card (Template-Matched Version)
app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();

    // Dữ liệu gốc từ n8n/SQL
    const p = data.player || {};
    const s = p.stats || {};
    const r = data.round_config || {};
    const g = p.grid || [];

    // Helper: Format số (70.0 -> 70)
    const fmt = (n) => (n ? parseFloat(n).toFixed(1).replace('.0', '') : null);

    // 1. CHUẨN BỊ Grid (Days) -> Map sang 'value_g'
    const daysMapped = g.map(d => {
        let valGram = 0;
        let statusClass = d.status; // 'logged', 'missing', 'future'

        // Logic đổi màu Grid theo Template
        // Template dùng class: 'gain' (tăng), 'loss' (giảm) cho ô màu
        // Nhưng SQL trả về 'logged'. Ta cần map lại:
        if (d.status === 'logged' && d.delta_from_start !== null) {
            valGram = Math.round(d.delta_from_start * 1000);
            if (valGram > 0) statusClass = 'gain';
            if (valGram < 0) statusClass = 'loss';
            if (valGram === 0) statusClass = 'logged'; // Hoặc 'loss' nhẹ
        }

        return {
            status: statusClass, // gain, loss, missing, future
            value_g: valGram,    // Template dùng {{value_g}}
            label: `NGÀY ${d.day}`, // Template dùng {{label}}
            leader: d.is_today ? "HÔM NAY" : null // Badge trên đầu ô
        };
    });

    // 2. CONTEXT MAPPING (Khớp chính xác với Template {{...}})
    const context = {
        player: {
            name: p.name || "Chiến Binh",
            team: p.team || "Marathon",
            avatar: p.avatar, // Nếu có
            round_name: r.name || "Vòng 1",
            // Dòng phụ: "Ngày 9, 09/12/2025"
            info_line: `Ngày ${r.day_index || 1}, ${new Date().toLocaleDateString('vi-VN')}`
        },
        
        stats: {
            // Ô 1: BẮT ĐẦU
            start: fmt(s.start_weight),
            
            // Ô 2: VỀ ĐÍCH (Chỉ hiện nếu là ngày cuối hoặc đã xong? Ở đây cứ hiện Current cho user vui)
            finish: fmt(s.current_weight), 
            
            // Ô 3: KẾT QUẢ (-3 hoặc +1)
            result: fmt(s.delta_weight),
            
            // Footer: "Cân nặng thay đổi..."
            current_change: fmt(s.delta_weight)
        },

        days: daysMapped
    };

    // 3. RENDER
    let templateName = data.template_url || "personal_progress_v1.hbs";
    
    // Slugify filename
    const cleanName = String(context.player.name)
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim().replace(/\s+/g, "_");
    const filename = `personal-${cleanName}-${timestamp}`;

    console.log(`[Render] Generating for ${context.player.name}...`);

    const width = data.width || 1080;
    const height = data.height || 1444; // Template set 1444px height

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
