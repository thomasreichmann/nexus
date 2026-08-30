/**
 * The transactional email library. Every template exports its component, its
 * props, and a `*Subject()` function — subject and body live in one file so the
 * whole message reads and tests as one unit, and a copy change can't drift
 * between the inbox line and what's inside.
 */
export { InviteEmail, inviteSubject, type InviteEmailProps } from './invite';
export {
    PasswordResetEmail,
    passwordResetSubject,
    type PasswordResetEmailProps,
} from './password-reset';
export {
    RetrievalReadyEmail,
    retrievalReadySubject,
    type RetrievalReadyEmailProps,
} from './retrieval-ready';
export {
    RetrievalRequestReadyEmail,
    retrievalRequestReadySubject,
    type RetrievalRequestReadyEmailProps,
} from './retrieval-request-ready';
