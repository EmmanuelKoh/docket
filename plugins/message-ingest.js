// plugins/message-ingest.js — the SMS/RCS ingestion feature, as a plugin.
//
// Unlike the other plugins, this one is PUSH-driven, not polled: messages
// arrive at the /ingest endpoint (forwarded from a phone), which uses Gemini
// to extract the tasks in each message and prints a slip for each (related
// items grouped into a list, unrelated tasks split apart). There is nothing
// to do on a timer, so this module is marked `passive` — /tick registers it
// (so it shows on the Slips page with an enable/disable toggle and editable
// config) but never calls run().
//
// The /ingest endpoint reads this plugin's registry record: it does nothing
// when the plugin is disabled, and takes its tunables from config below.
// Secrets (GEMINI_API_KEY, INGEST_TOKEN) stay in env — never in plugin
// config, which is stored and shown on the dashboard.
//
// Config (editable from the Plugins page):
//   minConfidence  0-1 threshold; a classified task only prints at or above
//                  it (a "task:" prefix always prints, bypassing this)
//   timezone       IANA zone for the "received at" stamp on the receipt
//   geminiModel    Gemini model id used for classification

export const id = 'message-ingest';

// Card copy for the dashboard's Recipes pages.
export const meta = {
  title: 'Message ingest',
  description: 'Classifies texts forwarded from your phone and prints task receipts.',
  category: 'messages',
};

// Push-driven: /tick registers the record but never runs it on a timer.
export const passive = true;

export const defaults = {
  enabled: true, // gated further by INGEST_TOKEN + GEMINI_API_KEY being set
  config: {
    minConfidence: 0.6,
    timezone: 'America/New_York',
    geminiModel: 'gemini-3.1-flash-lite',
  },
};

// Template this plugin prints with (shown on the dashboard card).
export const templates = ['Task'];

// Friendly labels for the dashboard's per-field config editor.
export const configLabels = {
  minConfidence: 'min confidence',
  geminiModel: 'gemini model',
};

// Never called (passive). Present only to satisfy the plugin contract.
export async function run({ state }) {
  return { state: state || {} };
}
