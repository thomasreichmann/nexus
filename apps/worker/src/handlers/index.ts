import { registerHandler } from '../registry';
import { buildRetrievalZip } from './buildRetrievalZip';
import { deleteAccount } from './deleteAccount';
import { generateThumbnail } from './generateThumbnail';

// Every handler is registered in both Lambdas — they run the same bundle, and
// which function picks a job up is decided by the queue it was published to
// (see queueUrlFor in ../jobs), not by what is registered here.
registerHandler('delete-account', deleteAccount);
registerHandler('generate-thumbnail', generateThumbnail);
registerHandler('build-retrieval-zip', buildRetrievalZip);
