export function createBenchmarkStudioFixtures() {
  return {
    contacts: [
      { id: "benchmark-studio-contact-1", email: "benchmark-studio+1@example.com", tier: 'growth' },
      { id: "benchmark-studio-contact-2", email: "benchmark-studio+2@example.com", tier: 'premium' }
    ],
    workspaces: [
      { id: "benchmark-studio-ws-1", name: "Benchmark Studio Demo East" },
      { id: "benchmark-studio-ws-2", name: "Benchmark Studio Demo West" }
    ],
    notes: ["Benchmark Studio fixture for the wave 6 route catalog", 'Supports targeted regression coverage']
  };
}

export function summarizeBenchmarkStudioFixtures(fixtures = createBenchmarkStudioFixtures()) {
  return { contacts: fixtures.contacts.length, workspaces: fixtures.workspaces.length, notes: fixtures.notes.length };
}

