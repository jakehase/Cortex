export function createCalendarApprovalsFixtures() {
  return {
    contacts: [
      { id: "calendar-approvals-contact-1", email: "calendar-approvals+1@example.com", tier: 'growth' },
      { id: "calendar-approvals-contact-2", email: "calendar-approvals+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "calendar-approvals-ws-1", name: "Calendar Approvals Demo East" },
      { id: "calendar-approvals-ws-2", name: "Calendar Approvals Demo West" }
    ],
    notes: ["Calendar Approvals fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeCalendarApprovalsFixtures(fixtures = createCalendarApprovalsFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

