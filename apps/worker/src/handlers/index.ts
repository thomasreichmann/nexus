import { registerHandler } from '../registry';
import { deleteAccount } from './deleteAccount';
import { generateThumbnail } from './generateThumbnail';

registerHandler('delete-account', deleteAccount);
registerHandler('generate-thumbnail', generateThumbnail);
