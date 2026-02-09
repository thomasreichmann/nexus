import { registerHandler } from '../registry';
import { deleteAccount } from './deleteAccount';

registerHandler('delete-account', deleteAccount);
