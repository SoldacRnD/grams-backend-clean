const { createCheckpointPage } = require('./notion/checkpoints');

// For internal use only; you can protect this later with a secret key or IP filter
app.post('/internal/notion/checkpoints', async (req, res) => {
  const { title, summary } = req.body || {};

  if (!title || !summary) {
    return res.status(400).json({ ok: false, error: 'MISSING_FIELDS' });
  }

  try {
    const page = await createCheckpointPage({
      title,
      summary,
      date: new Date(),
    });

    return res.json({ ok: true, pageId: page.id });
  } catch (err) {
    console.error('Error creating Notion checkpoint page:', err);
    return res.status(500).json({
      ok: false,
      error: 'NOTION_CHECKPOINT_ERROR',
      details: err.message || String(err),
    });
  }
});
