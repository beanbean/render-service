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
    console.log(`[AUTH FAIL] Client sent: '${k}'`);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
});

app.get("/", (_, res) => res.json({ ok: true, status: "alive", version: "v9-full-helpers" }));

// --- ĐĂNG KÝ FULL BỘ HELPER (FIX LỖI MISSING HELPER) ---
Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("neq", (a, b) => a !== b);
Handlebars.registerHelper("gt", (a, b) => a > b);
Handlebars.registerHelper("gte", (a, b) => a >= b);
Handlebars.registerHelper("lt", (a, b) => a < b);  // <-- Đây là cái đang thiếu
Handlebars.registerHelper("lte", (a, b) => a <= b);
Handlebars.registerHelper("add", (a, b) => a + b);
Handlebars.registerHelper("sub", (a, b) => a - b);

async function renderTemplate(file, data, opts = {}) {
  try {
    let src = "";
    const baseUrl = "https://raw.githubusercontent.com/beanbean/nexme-render-templates/main";
    const cleanFile = file.split('/').pop(); 
    const finalUrl = `${baseUrl}/${cleanFile}?t=${Date.now()}`;
    
    console.log(`[Template] Fetching: ${finalUrl}`);
    const response = await fetch(finalUrl);
    if (!response.ok) throw new Error(`Github 404: ${finalUrl}`);
    src = await response.text();
    
    const tpl = Handlebars.compile(src);
    return tpl(data);
  } catch (err) { throw err; }
}

app.post("/render/personal", async (req, res) => {
  try {
    const data = req.body;
    const timestamp = Date.now();
    
    const p = data.player || {};
    const s = data.stats || {}; 
    const g = p.grid || []; 

    const fmt = (n) => (n !== null && n !== undefined ? parseFloat(n).toFixed(1).replace('.0', '') : "--");

    const day10 = g.find(d => d.day === 10);
    const isFinished = day10 && (day10.status === 'logged' || (day10.delta_from_start !== null && day10.delta_from_start !== undefined));

    const daysMapped = g.map(d => {
        let valDisplay = "?";
        let statusClass = "future"; 

        if (d.delta_from_start !== null && d.delta_from_start !== undefined) {
            let delta = parseFloat(d.delta_from_start); 
            let deltaGram = Math.round(delta * 1000);

            if (deltaGram === 0) {
                statusClass = "logged"; 
                valDisplay = "0";
            } else if (deltaGram < 0) {
                statusClass = "loss";
                valDisplay = deltaGram; 
            } else {
                statusClass = "gain";
                valDisplay = "+" + deltaGram; 
            }
        } else {
            statusClass = "future"; 
            valDisplay = "?";
        }
        
        if (d.day === 1 && d.status === 'logged') {
             // Logic riêng cho ngày 1 nếu muốn
        }

        return {
            status: statusClass,
            value_g: valDisplay,
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
            info_line: p.info_line || `Ngày ${new Date().getDate()}`
        },
        stats: {
            start: fmt(s.start_weight),
            finish: isFinished ? fmt(s.current_weight) : "--", 
            result: isFinished ? fmt(s.delta_weight) : "--",
            current_change: fmt(s.delta_weight)
        },
        days: daysMapped
    };

    const filename = `personal-${timestamp}`;
    const html = await renderTemplate("personal_progress.hbs", context);
    
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: "new"
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1444 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    const base64 = (await page.screenshot({ type: "png" })).toString("base64");
    await browser.close();

    const imageUrl = await uploadToR2(base64, filename, "reports");
    res.json({ ok: true, image_url: imageUrl });

  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
