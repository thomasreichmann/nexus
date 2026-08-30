import { registerHandler } from '../registry';
import { deleteAccount } from './deleteAccount';
import { generateThumbnail } from './generateThumbnail';
import { initiateRestore } from './initiateRestore';

registerHandler('delete-account', deleteAccount);
registerHandler('generate-thumbnail', generateThumbnail);
registerHandler('initiate-restore', initiateRestore);
