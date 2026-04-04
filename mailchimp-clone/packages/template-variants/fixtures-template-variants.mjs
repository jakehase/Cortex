export function createTemplateVariantsFixtures() {
  return {
    contacts: [
      { id: "template-variants-contact-1", email: "template-variants+1@example.com", tier: 'growth' },
      { id: "template-variants-contact-2", email: "template-variants+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "template-variants-ws-1", name: "Template Variants Demo East" },
      { id: "template-variants-ws-2", name: "Template Variants Demo West" }
    ],
    notes: ["Template Variants fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeTemplateVariantsFixtures(fixtures = createTemplateVariantsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

