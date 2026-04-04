export function createTemplateApprovalsFixtures() {
  return {
    contacts: [
      { id: "template-approvals-contact-1", email: "template-approvals+1@example.com", tier: 'growth' },
      { id: "template-approvals-contact-2", email: "template-approvals+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "template-approvals-ws-1", name: "Template Approvals Demo East" },
      { id: "template-approvals-ws-2", name: "Template Approvals Demo West" }
    ],
    notes: ["Template Approvals fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeTemplateApprovalsFixtures(fixtures = createTemplateApprovalsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

