export function createSenderRotationFixtures() {
  return {
    contacts: [
      { id: "sender-rotation-contact-1", email: "sender-rotation+1@example.com", tier: 'growth' },
      { id: "sender-rotation-contact-2", email: "sender-rotation+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "sender-rotation-ws-1", name: "Sender Rotation Demo East" },
      { id: "sender-rotation-ws-2", name: "Sender Rotation Demo West" }
    ],
    notes: ["Sender Rotation fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeSenderRotationFixtures(fixtures = createSenderRotationFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

