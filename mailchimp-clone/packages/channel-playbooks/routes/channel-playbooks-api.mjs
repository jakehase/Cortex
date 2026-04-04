import { buildChannelPlaybooksSnapshot, createChannelPlaybooksApiDocument } from '../service-channel-playbooks.mjs';

export function createChannelPlaybooksApiRoutes(basePath = '/api/channel-playbooks') { const snapshot = buildChannelPlaybooksSnapshot(); return [{ id: 'channel-playbooks.api.overview', method: 'GET', path: basePath + '/overview', summary: snapshot.summary }, { id: 'channel-playbooks.api.validate', method: 'POST', path: basePath + '/validate', validation: snapshot.validation }, { id: 'channel-playbooks.api.document', method: 'GET', path: basePath + '/document', document: createChannelPlaybooksApiDocument(snapshot) }]; }

