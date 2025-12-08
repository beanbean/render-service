// --- 1. Leaderboard API ---
app.post("/render/leaderboard", async (req, res) => {
  try {
    const timestamp = Date.now();
    const filename = `daily-${req.body.name || "anon"}-${timestamp}`.replace(/\s+/g, "_");

    let templateName = req.body.template || "daily_leaderboard_v1";
    if (!templateName.endsWith(".hbs")) templateName += ".hbs";

    console.log(`[Render] Generating Leaderboard via ${templateName}...`);

    // 🔥 FIX: Lấy kích thước từ Body, nếu không có thì dùng mặc định
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

// --- 2. Personal Card API ---
app.post("/render/personal", async (req, res) => {
  try {
    const timestamp = Date.now();
    const playerName = (req.body.player && req.body.player.name) ? req.body.player.name : (req.body.name || "anon");
    const filename = `personal-${playerName}-${timestamp}`.replace(/\s+/g, "_");

    let templateName = req.body.template || "personal_progress_v1";
    if (!templateName.endsWith(".hbs")) templateName += ".hbs";

    console.log(`[Render] Generating Personal Card via ${templateName}...`);

    // 🔥 FIX: Lấy kích thước từ Body, nếu không có thì dùng mặc định
    const width = req.body.width || 1080;
    const height = req.body.height || 1350; 

    const base64 = await renderTemplate(templateName, req.body, { width, height });

    const imageUrl = await uploadToR2(base64, filename, "reports");
    res.json({ ok: true, image_url: imageUrl });
  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
