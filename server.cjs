cat > /app/server.cjs <<'EOF'
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

// Auth Middleware
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
app.get("/", (_, res) => res.json({ ok: true, status: "alive" }));

// Handlebars Helpers
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("gt", (a, b) => a > b);
Handlebars.registerHelper("lt", (a, b) => a < b);
Handlebars.registerHelper("add", (a, b) => a + b);

// Render Function
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

// API: Personal
app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();
    
    // --- LOGIC MAP DỮ LIỆU ĐƠN GIẢN ---
    const p = data.player || {};
    const s = p.stats || {};
    const g = p.grid || [];
    
    // Format số
    const fmt = (n) => (n !== null && n !== undefined ? parseFloat(n).toFixed(1).replace('.0', '') : "--");

    // Xử lý Grid ngày
    const daysMapped = g.map(d => {
        let valGram = "?";
        let statusClass = "future";
        
        if (d.status === 'logged' && d.delta_from_start !== null) {
            let delta = parseFloat(d.delta_from_start);
            // Logic màu
            if (delta < 0) statusClass = 'loss';
            else if (delta > 0) statusClass = 'gain';
            else statusClass = 'logged';
            
            // Đổi đơn vị
            if (Math.abs(delta) < 50) delta = delta * 1000;
            valGram = Math.round(delta);
        }
        
        return {
            status: statusClass,
            value_g: valGram,
            label: `NGÀY ${d.day}`,
            leader: d.is_today ? "HÔM NAY" : null
        };
    });

    const context = {
        player: p,
        stats: {
            start: fmt(s.start_weight),
            finish: fmt(s.current_weight),
            result: fmt(s.delta_weight),
            current_change: fmt(s.delta_weight)
        },
        days: daysMapped
    };

    const filename = `personal-${timestamp}`;
    
    // Hardcode tên file luôn cho chắc ăn (khỏi lo n8n gửi sai)
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
EOF
