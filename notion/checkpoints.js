// notion/checkpoints.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const { Client } = require('@notionhq/client');

// ────────────────────────────────────────────────
// 🔧 Environment + Notion setup
// ────────────────────────────────────────────────
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_CHECKPOINT_DB_ID = process.env.NOTION_CHECKPOINT_DB_ID;

if (!NOTION_TOKEN || !NOTION_CHECKPOINT_DB_ID) {
    console.warn('⚠️ Notion integration not fully configured (missing NOTION_TOKEN or NOTION_CHECKPOINT_DB_ID)');
}

const notion = new Client({ auth: NOTION_TOKEN });

// ────────────────────────────────────────────────
// 🧩 Helpers
// ────────────────────────────────────────────────

async function createCheckpointPage({
    title,
    summary,
    status = 'Not started',
    date = new Date(),
}) {
    if (!NOTION_TOKEN || !NOTION_CHECKPOINT_DB_ID) {
        throw new Error('Notion integration is not configured');
    }

    const isoDate = date.toISOString().split('T')[0];

    // This assumes your Notion DB has columns named:
    // - Title (title)
    // - Date (date)
    // - Summary (rich_text)
    // - Status (status)
    const page = await notion.pages.create({
        parent: { database_id: NOTION_CHECKPOINT_DB_ID },
        properties: {
            Title: {
                title: [
                    {
                        type: 'text',
                        text: { content: title || '' },
                    },
                ],
            },
            Date: {
                date: {
                    start: isoDate,
                },
            },
            Summary: {
                rich_text: [
                    {
                        type: 'text',
                        text: { content: summary || '' },
                    },
                ],
            },
            Status: {
                status: status ? { name: status } : null,
            },
        },
        // Simple body: we can make it fancier later
        children: [
            {
                object: 'block',
                heading_1: {
                    rich_text: [
                        { type: 'text', text: { content: title || '' } },
                    ],
                },
            },
            {
                object: 'block',
                paragraph: {
                    rich_text: [
                        {
                            type: 'text',
                            text: { content: summary || '' },
                        },
                    ],
                },
            },
        ],
    });

    return page;
}

// ────────────────────────────────────────────────
// 🚀 Routes
// ────────────────────────────────────────────────

// Create a new checkpoint (Supabase → Notion)
router.post('/', async (req, res) => {
    const { title, summary, status = 'Not started' } = req.body || {};

    if (!title || !summary) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_FIELDS',
            details: 'title and summary are required',
        });
    }

    try {
        console.log('📌 Creating checkpoint:', { title, status });

        // 1) Create page in Notion
        const notionPage = await createCheckpointPage({ title, summary, status });

        // 2) Insert row into Supabase
        const { data, error } = await supabase
            .from('checkpoints')
            .insert([
                {
                    title,
                    summary,
                    status,
                    notion_page_id: notionPage.id,
                },
            ])
            .select()
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            checkpoint: data,
            notion_page_id: notionPage.id,
        });
    } catch (err) {
        console.error('❌ Error creating checkpoint:', err);
        return res.status(500).json({
            success: false,
            error: 'CHECKPOINT_CREATE_ERROR',
            details: err.message || String(err),
        });
    }
});

// Update existing checkpoint
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { title, summary, status } = req.body || {};

    try:
    // Get Notion page id from Supabase
    const { data: checkpoint, error: fetchError } = await supabase
        .from('checkpoints')
        .select('notion_page_id')
        .eq('id', id)
        .single();

    if (fetchError || !checkpoint) {
        return res.status(404).json({ success: false, error: 'CHECKPOINT_NOT_FOUND' });
    }

    const pageId = checkpoint.notion_page_id;

    // Update in Notion
    await notion.pages.update({
        page_id: pageId,
        properties: {
            Title: title
                ? {
                    title: [
                        {
                            type: 'text',
                            text: { content: title },
                        },
                    ],
                }
                : undefined,
            Summary: summary
                ? {
                    rich_text: [
                        {
                            type: 'text',
                            text: { content: summary },
                        },
                    ],
                }
                : undefined,
            Status: status
                ? { status: { name: status } }
                : undefined,
        },
    });

    // Update in Supabase
    const { data: updated, error: updateError } = await supabase
        .from('checkpoints')
        .update({
            title,
            summary,
            status,
            updated_at: new Date(),
        })
        .eq('id', id)
        .select()
        .single();

    if (updateError) throw updateError;

    return res.json({ success: true, checkpoint: updated });
} catch (err) {
    console.error('❌ Error updating checkpoint:', err);
    return res.status(500).json({
        success: false,
        error: 'CHECKPOINT_UPDATE_ERROR',
        details: err.message || String(err),
    });
}
});

// List all checkpoints
router.get('/', async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('checkpoints')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        return res.json({ success: true, checkpoints: data });
    } catch (err) {
        console.error('❌ Error listing checkpoints:', err);
        return res.status(500).json({
            success: false,
            error: 'CHECKPOINT_LIST_ERROR',
            details: err.message || String(err),
        });
    }
});

// ────────────────────────────────────────────────
// ✅ Export router + helper
// ────────────────────────────────────────────────
module.exports = {
    router,
    createCheckpointPage,
};
