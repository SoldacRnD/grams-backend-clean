// notion/checkpoints.js
const express = require('express');
const router = express.Router();
const { supabase } = require('../db/supabase');
const { Client } = require('@notionhq/client');

const RAW_MAIN_PAGE_ID =
    process.env.NOTION_MAIN_PAGE_ID || '2c3a8022ebcf80e59517d0bc774efe68';

// Helper: normalize Notion IDs to UUID-with-dashes
function formatNotionId(id) {
    if (!id) return id;
    const clean = id.replace(/-/g, '');
    if (clean.length !== 32) return id; // already in some acceptable format
    return (
        clean.slice(0, 8) + '-' +
        clean.slice(8, 12) + '-' +
        clean.slice(12, 16) + '-' +
        clean.slice(16, 20) + '-' +
        clean.slice(20)
    );
}

const NOTION_MAIN_PAGE_ID = formatNotionId(RAW_MAIN_PAGE_ID);

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
    status = 'Not started',
    date = new Date(),
}) {
    if (!NOTION_TOKEN || !NOTION_CHECKPOINT_DB_ID) {
        throw new Error('Notion integration is not configured');
    }

    const isoDate = date.toISOString().split('T')[0];

    const page = await notion.pages.create({
        parent: { database_id: NOTION_CHECKPOINT_DB_ID },

        // 🧩 Table properties
        properties: {
            Title: {
                title: [
                    { type: 'text', text: { content: title || '' } },
                ],
            },
            Date: {
                date: {
                    start: isoDate,
                },
            },
            Summary: {
                rich_text: [
                    { type: 'text', text: { content: summary || '' } },
                ],
            },
            Status: {
                // 👇 important: Status-type property uses "status", not "select"
                status: status ? { name: status } : null,
            },
        },

        // 🧱 Page body layout – this is where we make it “nice”
        children: [
            // Big heading
            {
                object: 'block',
                heading_1: {
                    rich_text: [
                        { type: 'text', text: { content: title || '' } },
                    ],
                },
            },

            // Small “meta” paragraph
            {
                object: 'block',
                paragraph: {
                    rich_text: [
                        { type: 'text', text: { content: 'Checkpoint in A Gram of Art development timeline.' } },
                    ],
                },
            },

            // Divider
            { object: 'block', divider: {} },

            // Overview section
            {
                object: 'block',
                heading_2: {
                    rich_text: [
                        { type: 'text', text: { content: 'Overview' } },
                    ],
                },
            },
            {
                object: 'block',
                paragraph: {
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: summary || 'No overview provided.',
                            },
                        },
                    ],
                },
            },

            // Today’s changes section
            {
                object: 'block',
                heading_2: {
                    rich_text: [
                        { type: 'text', text: { content: 'What we implemented today' } },
                    ],
                },
            },
            {
                object: 'block',
                bulleted_list_item: {
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: 'Notion ↔ backend checkpoint flow stabilized (fields + Status).',
                            },
                        },
                    ],
                },
            },
            {
                object: 'block',
                bulleted_list_item: {
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: 'Detailed checkpoint pages now created automatically from ChatGPT/agent.',
                            },
                        },
                    ],
                },
            },
            {
                object: 'block',
                bulleted_list_item: {
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: 'Shopify multi-media product flow remains working from Producer UI.',
                            },
                        },
                    ],
                },
            },

            // Next steps section
            {
                object: 'block',
                heading_2: {
                    rich_text: [
                        { type: 'text', text: { content: 'Next steps' } },
                    ],
                },
            },
            {
                object: 'block',
                bulleted_list_item: {
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: 'Add full Shopify product editing (status, tags, SEO, etc.) in Producer UI.',
                            },
                        },
                    ],
                },
            },
            {
                object: 'block',
                bulleted_list_item: {
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: 'Start Vendor UI for perk redemption.',
                            },
                        },
                    ],
                },
            },
            {
                object: 'block',
                bulleted_list_item: {
                    rich_text: [
                        {
                            type: 'text',
                            text: {
                                content: 'Implement NFC claim flow animations + customer-facing polish.',
                            },
                        },
                    ],
                },
            },
        ],
    });

    return page;
}

async function appendCheckpointToMainPage({
    title,
    summary,
    status = 'Not started',
    date = new Date(),
    notionPageId,
}) {
    if (!NOTION_MAIN_PAGE_ID) {
        throw new Error('NOTION_MAIN_PAGE_ID not set, cannot update main page.');
    }

    const isoDate = date.toISOString().split('T')[0];
    const blockId = NOTION_MAIN_PAGE_ID;

    const checkpointUrl = `https://www.notion.so/${notionPageId.replace(/-/g, '')}`;

    console.log('🧱 Appending checkpoint to main page:', {
        blockId,
        title,
        status,
        isoDate,
    });

    try {
        await notion.blocks.children.append({
            block_id: blockId,
            children: [
                {
                    object: 'block',
                    heading_3: {
                        rich_text: [
                            {
                                type: 'text',
                                text: { content: title || 'Untitled checkpoint' },
                            },
                        ],
                    },
                },
                {
                    object: 'block',
                    paragraph: {
                        rich_text: [
                            {
                                type: 'text',
                                text: {
                                    content: `Status: ${status} · Date: ${isoDate}`,
                                },
                            },
                        ],
                    },
                },
                {
                    object: 'block',
                    paragraph: {
                        rich_text: [
                            {
                                type: 'text',
                                text: {
                                    content: summary || '',
                                    link: { url: checkpointUrl },
                                },
                            },
                        ],
                    },
                },
                { object: 'block', divider: {} },
            ],
        });

        console.log('✅ Main project page updated with new checkpoint block.');
    } catch (err) {
        // Surface the real Notion error so the API caller sees it
        const msg = err.body ? JSON.stringify(err.body) : err.message;
        console.error('❌ Failed to append blocks to main page:', msg);
        throw new Error(`MAIN_PAGE_APPEND_ERROR: ${msg}`);
    }
}


// ────────────────────────────────────────────────
// 🚀 Routes
// ────────────────────────────────────────────────

// Create a new checkpoint (Supabase → Notion)

router.post('/', async (req, res) => {
    const { title, summary, status = 'Not started' } = req.body;

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

        // ⬇️ NEW: append a summary block to the main "A Gram of Art" page
        // Append to main A Gram of Art page as part of the same operation
        await appendCheckpointToMainPage({
            title,
            summary,
            status,
            date: new Date(),
            notionPageId: notionPage.id,
        });

        res.json({
            success: true,
            checkpoint: data,
            notion_page_id: notionPage.id,
            main_page_updated: true,
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

        await notion.pages.update({
            page_id: pageId,
            properties: {
                Title: {
                    title: [
                        { type: 'text', text: { content: title || '' } },
                    ],
                },
                Summary: {
                    rich_text: [
                        { type: 'text', text: { content: summary || '' } },
                    ],
                },
                Status: status
                    ? { status: { name: status } }
                    : undefined,
            },
        });

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
