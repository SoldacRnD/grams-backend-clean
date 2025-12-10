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
    console.warn('⚠️ Notion integration not fully configured (missing env vars)');
}

const notion = new Client({ auth: NOTION_TOKEN });

// ────────────────────────────────────────────────
// 🧩 Helpers
// ────────────────────────────────────────────────
const notionText = (text) => [
    { type: 'text', text: { content: text || '' } },
];

// Create a Notion page dynamically (schema-aware)
async function createCheckpointPage({
    title,
    summary,
    status = 'Planned',
    date = new Date(),
}) {
    if (!NOTION_TOKEN || !NOTION_CHECKPOINT_DB_ID) {
        throw new Error('Notion integration is not configured');
    }

    const isoDate = date.toISOString().split('T')[0];

    // Get DB schema so we can map to whatever you actually have
    const db = await notion.databases.retrieve({
        database_id: NOTION_CHECKPOINT_DB_ID,
    });

    const props = db.properties || {};

    const titleProp = Object.keys(props).find((k) => props[k].type === 'title');
    const summaryProp = Object.keys(props).find(
        (k) => props[k].type === 'rich_text' && k.toLowerCase().includes('summary')
    );
    const dateProp = Object.keys(props).find((k) => props[k].type === 'date');
    const statusProp = Object.keys(props).find(
        (k) => props[k].type === 'select' && k.toLowerCase().includes('status')
    );

    if (!titleProp) {
        throw new Error('No title property found in the Notion checkpoints database');
    }

    const properties = {};

    // Title column (whatever it’s called in your DB)
    properties[titleProp] = {
        title: notionText(title),
    };

    // Optional Summary column IF you added one of type "Text" (rich_text in API)
    if (summaryProp && summary) {
        properties[summaryProp] = {
            rich_text: notionText(summary),
        };
    }

    // Optional Date column
    if (dateProp) {
        properties[dateProp] = {
            date: {
                start: isoDate,
            },
        };
    }

    // Optional Status column (select)
    if (statusProp && status) {
        properties[statusProp] = {
            select: { name: status },
        };
    }

    // Detailed page content (children blocks)
    const children = [];

    if (summary) {
        children.push(
            {
                object: 'block',
                heading_2: {
                    rich_text: [
                        { type: 'text', text: { content: 'Summary' } },
                    ],
                },
            },
            {
                object: 'block',
                paragraph: {
                    rich_text: [
                        { type: 'text', text: { content: summary } },
                    ],
                },
            }
        );
    }

    // You can add more structure here later (bullet lists, code blocks, etc.)

    const page = await notion.pages.create({
        parent: { database_id: NOTION_CHECKPOINT_DB_ID },
        properties,
        children,
    });

    return page;
}


// ────────────────────────────────────────────────
// 🚀 Routes
// ────────────────────────────────────────────────

// Create a new checkpoint (Supabase → Notion)

router.post('/', async (req, res) => {
    const { title, summary, status = 'Planned' } = req.body;

    try {
        console.log('📌 Creating checkpoint in Notion:', { title, summary, status });

        const notionPage = await createCheckpointPage({ title, summary, status });

        console.log('✅ Notion page created:', notionPage.id);

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

        res.json({
            success: true,
            checkpoint: data,
            notion_page_id: notionPage.id,
        });
    } catch (err) {
        console.error('❌ Error creating checkpoint:', err);
        res.status(500).json({ error: err.message });
    }
});


// Update existing checkpoint (bi-directional)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { title, summary, status } = req.body;

    try {
        const { data: checkpoint, error: fetchError } = await supabase
            .from('checkpoints')
            .select('notion_page_id')
            .eq('id', id)
            .single();

        if (fetchError || !checkpoint) {
            return res.status(404).json({ error: 'Checkpoint not found' });
        }

        const pageId = checkpoint.notion_page_id;
        const db = await notion.databases.retrieve({
            database_id: NOTION_CHECKPOINT_DB_ID,
        });
        const props = db.properties || {};

        const titleProp = Object.keys(props).find((k) => props[k].type === 'title');
        const summaryProp = Object.keys(props).find(
            (k) => props[k].type === 'rich_text' && k.toLowerCase().includes('summary')
        );
        const statusProp = Object.keys(props).find(
            (k) => props[k].type === 'select' && k.toLowerCase().includes('status')
        );

        const properties = {};
        if (titleProp) properties[titleProp] = { title: notionText(title) };
        if (summaryProp) properties[summaryProp] = { rich_text: notionText(summary) };
        if (statusProp && status) {
            properties[statusProp] = { select: { name: status } };
        }

        await notion.pages.update({ page_id: pageId, properties });

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

        res.json({ success: true, checkpoint: updated });
    } catch (err) {
        console.error('❌ Error updating checkpoint:', err);
        res.status(500).json({ error: err.message });
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
        res.json({ success: true, checkpoints: data });
    } catch (err) {
        console.error('❌ Error listing checkpoints:', err);
        res.status(500).json({ error: err.message });
    }
});

// Sync Notion → Supabase
router.get('/sync', async (_req, res) => {
    try {
        const notionPages = await notion.databases.query({
            database_id: NOTION_CHECKPOINT_DB_ID,
        });

        for (const page of notionPages.results) {
            const props = page.properties;

            // These assume specific property names; adjust if different in your DB:
            const title =
                props.Title?.title?.[0]?.plain_text ||
                props.Name?.title?.[0]?.plain_text ||
                '';
            const summary =
                props.Summary?.rich_text?.[0]?.plain_text || '';
            const status =
                props.Status?.select?.name || 'Planned';

            await supabase.from('checkpoints').upsert({
                title,
                summary,
                status,
                notion_page_id: page.id,
            });
        }

        res.json({ success: true, message: '✅ Notion → Supabase sync complete' });
    } catch (err) {
        console.error('❌ Sync error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ────────────────────────────────────────────────
// ✅ Export router + helper
// ────────────────────────────────────────────────
module.exports = {
    router,               // Express router
    createCheckpointPage, // Notion helper
};
