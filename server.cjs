cat > /app/server.cjs <<EOF
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
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const k = req.header("x-api-key") || req.query.api_key;
  if (k !== API_KEY) {
    console.log(\`[AUTH FAIL] Client sent: '\${k}'\`);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

app.get("/", (_, res) => res.json({ ok: true, mode: "leaderboard-ready-v6-logic-fix" }));

// Helper
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("gt", (a, b) => a > b);
Handlebars.registerHelper("lt", (a, b) => a < b);
Handlebars.registerHelper("add", (a, b) => a + b);

async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    let fileNameClean = file;
    if (file.startsWith("http")) {
        const parts = file.split('/');
        fileNameClean = parts[parts.length - 1];
    }
    const localPath = path.join(__dirname, "templates", fileNameClean);
    try {
      src = await fs.readFile(localPath, "utf8");
    } catch (err) {
      const baseUrl = process.env.TEMPLATE_BASE_URL || "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
      let finalUrl = file.startsWith("http") ? file : \`\${baseUrl}/\${file}\`;
      finalUrl += (finalUrl.includes('?') ? '&' : '?') + \`t=\${Date.now()}\`;
      console.log(\`[Template] Fetching FRESH: \${finalUrl}\`);
      const response = await fetch(finalUrl);
      if (!response.ok) throw new Error(\`Failed to fetch template (\${response.status})\`);
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

// --- API LEADERBOARD ---
app.post("/render/leaderboard", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();
    const teamName = data.player?.team || "Team";
    const cleanName = String(teamName).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");
    const filename = \`leaderboard-\${cleanName}-\${timestamp}\`;
    let templateName = data.template_url || "daily_leaderboard_v1.hbs";
    
    const width = data.width || 1080;
    const height = data.height || 1600;
    const base64 = await renderTemplate(templateName, data, { width, height });
    const imageUrl = await uploadToR2(base64, filename, "reports");
    res.json({ ok: true, image_url: imageUrl });
  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- API PERSONAL CARD (LOGIC MỚI) ---
app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();
    const p = data.player || {};
    const s = p.stats || {};
    const r = data.round_config || {};
    const g = p.grid || [];
    const fmt = (n) => (n !== null && n !== undefined ? parseFloat(n).toFixed(1).replace('.0', '') : null);

    // 1. Kiểm tra đã hoàn thành vòng (Ngày 10 đã log chưa?)
    const hasFinishedDay10 = g.some(d => d.day == 10 && (d.status === 'logged' || d.delta_from_start !== null));

    // 2. Map dữ liệu Grid
    const daysMapped = g.map(d => {
        let valDisplay = "?"; // Mặc định là dấu hỏi
        let statusClass = "future"; // Mặc định màu xám

        // Nếu đã log và có số liệu
        if (d.status === 'logged' && d.delta_from_start !== null && d.delta_from_start !== undefined) {
            let delta = parseFloat(d.delta_from_start);
            
            // Logic đổi màu
            if (delta < 0) statusClass = 'loss';      // Xanh lá (Giảm)
            else if (delta > 0) statusClass = 'gain'; // Cam (Tăng)
            else statusClass = 'logged';              // Xám đậm (Đứng cân)

            // Logic hiển thị số (đổi sang Grams: -0.5 -> -500)
            let valGram = Math.round(delta * 1000);
            valDisplay = valGram; 
        }

        return {
            status: statusClass,
            value_g: valDisplay,
            label: \`NGÀY \${d.day}\`,
            leader: d.is_today ? "HÔM NAY" : null
        };
    });

    // 3. Chuẩn bị Context
    const context = {
        player: {
            name: p.name || "Chiến Binh",
            team: p.team || "Marathon",
            avatar: p.avatar,
            round_name: r.name || "Vòng 1",
            info_line: \`Ngày \${r.day_index || 1}, \${new Date().toLocaleDateString('vi-VN')}\`
        },
        stats: {
            start: fmt(s.start_weight),
            
            // Ô VỀ ĐÍCH & KẾT QUẢ (TO): Chỉ hiện khi đã xong ngày 10, ngược lại hiện null (template sẽ hiển thị ?)
            finish: hasFinishedDay10 ? fmt(s.current_weight) : null,
            result: hasFinishedDay10 ? fmt(s.delta_weight) : null,
            
            // DÒNG CHỮ DƯỚI CÙNG: Luôn hiện tổng giảm thực tế tính đến hôm nay
            current_change: fmt(s.delta_weight)
        },
        days: daysMapped
    };

    let templateName = data.template_url || "personal_progress_v1.hbs";
    const cleanName = String(context.player.name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "_");
    const filename = \`personal-\${cleanName}-\${timestamp}\`;
    
    const base64 = await renderTemplate(templateName, context, { width: 1080, height: 1444 });
    const imageUrl = await uploadToR2(base64, filename, "reports");
    
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`✅ render-service on \${PORT}\`));
EOF
