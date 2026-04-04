export function createWebhookInspectorFixtures() {
  return {
    contacts: [
      { id: "webhook-inspector-contact-1", email: "webhook-inspector+1@example.com", tier: 'growth' },
      { id: "webhook-inspector-contact-2", email: "webhook-inspector+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "webhook-inspector-ws-1", name: "Webhook Inspector Demo East" },
      { id: "webhook-inspector-ws-2", name: "Webhook Inspector Demo West" }
    ],
    notes: ["Webhook Inspector fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeWebhookInspectorFixtures(fixtures = createWebhookInspectorFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

