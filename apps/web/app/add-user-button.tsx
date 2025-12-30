'use client';

import { addRandomUser } from './actions';

export function AddUserButton() {
    return (
        <button
            onClick={() => addRandomUser()}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
            Add Random User
        </button>
    );
}
