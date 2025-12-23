const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const bodyParser = require("body-parser");
const Handlebars = require("handlebars");
const puppeteer = require("puppeteer");
const uploadToR2 = require("./upload-r2.cjs");

const app = express();
app.use(bodyParser.json({ limit: "5mb" })); 

const API_KEY = process.env.API_KEY || "";

// Auth Middleware (GIỮ NGUYÊN)
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const k = req.header("x-api-key") || req.query.api_key;
  if (k !== API_KEY) {
    console.log(`[AUTH FAIL] Client sent: '${k}'`);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

// Health Check
app.get("/", (_, res) => res.json({ ok: true, status: "alive", version: "v7-fixed-info-line" }));

// Handlebars Helpers (GIỮ NGUYÊN)
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("gt", (a, b) => a > b);
Handlebars.registerHelper("lt", (a, b) => a < b);
Handlebars.registerHelper("add", (a, b) => a + b);

// Render Function (GIỮ NGUYÊN LOGIC FALLBACK GITHUB)
async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    // Ưu tiên tải từ GitHub (Public Repo)
    const baseUrl = "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
    // Xử lý tên file (bỏ folder con nếu n8n gửi sai)
    const cleanFile = file.split('/').pop(); 
    const finalUrl = `${baseUrl}/${cleanFile}?t=${Date.now()}`;
      
    console.log(`[Template] Fetching: ${finalUrl}`);
    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Github 404: ${finalUrl}`);
    src = await response.text();

    const tpl = Handlebars.compile(src);
    const html = tpl(data);
    
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new"
    });
    const page = await browser.newPage();
    await page.setViewport({ width: opts.width || 1080, height: opts.height || 1444 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const buf = await page.screenshot({ type: "png" });
    await browser.close();
    return buf.toString("base64");
  } catch (err) {
    console.error("Render error:", err);
    throw err;
  }
}

// API: Personal Progress (CẢI TIẾN LOGIC HIỂN THỊ)
app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();
    
    // --- LOGIC MAP DỮ LIỆU ---
    const p = data.player || {};
    const s = p.stats || {};
    const g = p.grid || [];
    
    // Helper format số: Nếu null/undefined thì trả về "--", nếu có số thì format 1 số lẻ
    const fmt = (n) => (n !== null && n !== undefined ? parseFloat(n).toFixed(1).replace('.0', '') : "--");

    // Xử lý Grid ngày (Ô vuông nhỏ)
    const daysMapped = g.map(d => {
        let valGram = "?";
        let statusClass = "future";
        
        // Chỉ xử lý nếu có dữ liệu delta (tức là đã log)
        if (d.delta_from_start !== null && d.delta_from_start !== undefined) {
            let delta = parseFloat(d.delta_from_start);
            
            // 1. Logic tô màu
            if (delta < 0) statusClass = 'loss';      // Giảm cân -> Xanh
            else if (delta > 0) statusClass = 'gain'; // Tăng cân -> Cam
            else statusClass = 'logged';              // Giữ cân -> Xám đậm
            
            // 2. Logic đổi đơn vị (kg -> g cho đẹp)
            // Nếu số nhỏ (< 50) thì đoán là kg => nhân 1000
            if (Math.abs(delta) < 50) delta = delta * 1000;
            
            valGram = Math.round(delta);
        } else if (d.status === 'missing') {
            statusClass = 'missing';
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
            name: p.name,
            team: p.team,
            avatar: p.avatar,
            round_name: p.round_name,
            // 🔥 CẢI TIẾN: Ưu tiên dùng info_line từ Database gửi lên (VD: "23/12 - 01/01")
            // Nếu không có mới fallback về ngày hiện tại
            info_line: p.info_line || `Ngày ${new Date().getDate()}`
        },
        stats: {
            start: fmt(s.start_weight),
            // 🔥 CẢI TIẾN: Luôn hiển thị số liệu thực tế, không ẩn đi
            finish: fmt(s.current_weight),
            result: fmt(s.delta_weight),
            current_change: fmt(s.delta_weight)
        },
        days: daysMapped
    };

    const filename = `personal-${timestamp}`;
    
    // Hardcode tên template để tránh lỗi đường dẫn n8n
    const base64 = await renderTemplate("personal_progress.hbs", context, { width: 1080, height: 1444 });
    
    const imageUrl = await uploadToR2(base64, filename, "reports");
    
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
