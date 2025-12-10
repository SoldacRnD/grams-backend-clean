// notion/checkpoints.js
const { Client } = require('@notionhq/client');

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_CHECKPOINT_DB_ID = process.env.NOTION_CHECKPOINT_DB_ID;

if (!NOTION_TOKEN || !NOTION_CHECKPOINT_DB_ID) {
  console.warn('Notion integration not fully configured (missing NOTION_TOKEN or NOTION_CHECKPOINT_DB_ID)');
}

const notion = new Client({ auth: NOTION_TOKEN });

async function createCheckpointPage({ title, summary, date = new Date() }) {
  if (!NOTION_TOKEN || !NOTION_CHECKPOINT_DB_ID) {
    throw new Error('Notion integration is not configured');
  }

  const isoDate = date.toISOString().split('T')[0];

  const response = await notion.pages.create({
    parent: { database_id: NOTION_CHECKPOINT_DB_ID },
    properties: {
        Name: {
            title: [
                {
                    type: "text",
                    text: { content: title },
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
            text: { content: summary },
          },
        ],
      },
    },
  });

  return response;
}

module.exports = {
  createCheckpointPage,
};
