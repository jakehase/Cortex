export function createDeliverabilityWarRoomFixtures() {
  return {
    contacts: [
      { id: "deliverability-war-room-contact-1", email: "deliverability-war-room+1@example.com", tier: 'growth' },
      { id: "deliverability-war-room-contact-2", email: "deliverability-war-room+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "deliverability-war-room-ws-1", name: "Deliverability War Room Demo East" },
      { id: "deliverability-war-room-ws-2", name: "Deliverability War Room Demo West" }
    ],
    notes: ["Deliverability War Room fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeDeliverabilityWarRoomFixtures(fixtures = createDeliverabilityWarRoomFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

