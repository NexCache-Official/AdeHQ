export type IntegrationDef = {
  id: string;
  name: string;
  short: string;
  color: string;
};

export const INTEGRATION_TOOL_ALIASES: Record<string, string> = {
  githubapp: "github",
  gcal: "calendar",
  gsheets: "google-drive",
  gdrive: "google-drive",
};

/** Recognizable third-party brands shown on CRM, Calendar, Investors, and Tasks pages. */
export const INTEGRATION_CATALOG: Record<string, IntegrationDef> = {
  hubspot: { id: "hubspot", name: "HubSpot", short: "H", color: "#ff7a59" },
  salesforce: { id: "salesforce", name: "Salesforce", short: "SF", color: "#00a1e0" },
  pipedrive: { id: "pipedrive", name: "Pipedrive", short: "P", color: "#1a1a1a" },
  gmail: { id: "gmail", name: "Gmail", short: "G", color: "#ea4335" },
  outlook: { id: "outlook", name: "Outlook", short: "O", color: "#0078d4" },
  slack: { id: "slack", name: "Slack", short: "S", color: "#611f69" },
  notion: { id: "notion", name: "Notion", short: "N", color: "#111111" },
  linear: { id: "linear", name: "Linear", short: "L", color: "#5e6ad2" },
  jira: { id: "jira", name: "Jira", short: "J", color: "#2684ff" },
  githubapp: { id: "githubapp", name: "GitHub", short: "GH", color: "#24292e" },
  zapier: { id: "zapier", name: "Zapier", short: "Z", color: "#ff4a00" },
  make: { id: "make", name: "Make", short: "M", color: "#6d00cc" },
  airtable: { id: "airtable", name: "Airtable", short: "A", color: "#fcb400" },
  gsheets: { id: "gsheets", name: "Google Sheets", short: "GS", color: "#0f9d58" },
  gcal: { id: "gcal", name: "Google Calendar", short: "GC", color: "#4285f4" },
  gdrive: { id: "gdrive", name: "Google Drive", short: "GD", color: "#1fa463" },
  buffer: { id: "buffer", name: "Buffer", short: "B", color: "#2c4bff" },
  linkedin: { id: "linkedin", name: "LinkedIn", short: "in", color: "#0a66c2" },
  meta: { id: "meta", name: "Meta", short: "M", color: "#0866ff" },
  x: { id: "x", name: "X", short: "X", color: "#111111" },
  mailchimp: { id: "mailchimp", name: "Mailchimp", short: "MC", color: "#ffe01b" },
  stripe: { id: "stripe", name: "Stripe", short: "St", color: "#635bff" },
  quickbooks: { id: "quickbooks", name: "QuickBooks", short: "QB", color: "#2ca01c" },
  docsend: { id: "docsend", name: "DocSend", short: "DS", color: "#1a73e8" },
  affinity: { id: "affinity", name: "Affinity", short: "Af", color: "#3855ff" },
  crunchbase: { id: "crunchbase", name: "Crunchbase", short: "CB", color: "#0288d1" },
  calendly: { id: "calendly", name: "Calendly", short: "Cy", color: "#006bff" },
  zoom: { id: "zoom", name: "Zoom", short: "Zm", color: "#2d8cff" },
  typeform: { id: "typeform", name: "Typeform", short: "Tf", color: "#262627" },
  webhook: { id: "webhook", name: "Webhooks", short: "{ }", color: "#64748b" },
};
