import type { HandlerContext } from '../registry';

export async function deleteAccount(
    _ctx: HandlerContext<'delete-account'>
): Promise<void> {
    throw new Error('delete-account handler not yet implemented');
}
