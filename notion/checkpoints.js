// routes/checkpoints.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../utils/supabaseClient');
const { createCheckpointPage } = require('../notion/checkpoints');
const { Client } = require('@notionhq/client');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_CHECKPOINT_DB_ID = process.env.NOTION_CHECKPOINT_DB_ID;

const notion = new Client({ auth: NOTION_TOKEN });

// Utility helper to wrap text in Notion format
const notionText = (text) => [
    {
        type: 'text',
        text: { content: text || '' },
    },
];

// ✅ Create a new checkpoint (Supabase → Notion)
router.post('/', async (req, res) => {
    const { title, summary, status = 'Planned' } = req.body;

    try {
        // 1. Create the Notion page dynamically (using your helper)
        const notionPage = await createCheckpointPage({
            title,
            summary,
        });

        // 2. Insert checkpoint record in Supabase
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
        console.error('❌ Error creating checkpoint:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ✅ Update existing checkpoint (bi-directional)
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { title, summary, status } = req.body;

    try {
        // Fetch existing checkpoint from Supabase
        const { data: checkpoint, error: fetchError } = await supabase
            .from('checkpoints')
            .select('notion_page_id')
            .eq('id', id)
            .single();

        if (fetchError || !checkpoint) {
            return res.status(404).json({ error: 'Checkpoint not found' });
        }

        const pageId = checkpoint.notion_page_id;

        // Update Notion page
        const db = await notion.databases.retrieve({
            database_id: NOTION_CHECKPOINT_DB_ID,
        });
        const props = db.properties || {};
        const titlePropName = Object.keys(props).find((key) => props[key].type === 'title');
        const summaryPropName = Object.keys(props).find(
            (key) => props[key].type === 'rich_text' && key.toLowerCase() === 'summary'
        );
        const statusPropName = Object.keys(props).find(
            (key) => props[key].type === 'select' && key.toLowerCase() === 'status'
        );

        const properties = {};
        if (titlePropName)
            properties[titlePropName] = { title: notionText(title) };
        if (summaryPropName)
            properties[summaryPropName] = { rich_text: notionText(summary) };
        if (statusPropName)
            properties[statusPropName] = { select: { name: status } };

        await notion.pages.update({
            page_id: pageId,
            properties,
        });

        // Update Supabase record
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

// ✅ List all checkpoints
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('checkpoints')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ success: true, checkpoints: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ (Optional) CRON Sync – Notion → Supabase
router.get('/sync', async (req, res) => {
    try {
        const notionPages = await notion.databases.query({
            database_id: NOTION_CHECKPOINT_DB_ID,
        });

        for (const page of notionPages.results) {
            const props = page.properties;
            const title = props.Title?.title?.[0]?.plain_text || '';
            const summary = props.Summary?.rich_text?.[0]?.plain_text || '';
            const status = props.Status?.select?.name || 'Planned';

            await supabase
                .from('checkpoints')
                .upsert({
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

module.exports = router;
