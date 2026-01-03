import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignOutButton } from './sign-out-button';

// Mock dependencies
vi.mock('next/navigation', () => ({
    useRouter: () => ({
        push: vi.fn(),
        refresh: vi.fn(),
    }),
}));

vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({
        invalidateQueries: vi.fn(),
    }),
}));

vi.mock('@/lib/auth/client', () => ({
    authClient: {
        signOut: vi.fn(),
    },
}));

describe('SignOutButton', () => {
    it('renders sign out button with correct text', () => {
        render(<SignOutButton />);
        const button = screen.getByRole('button', { name: /sign out/i });
        expect(button).toBeInTheDocument();
        expect(button).toHaveClass('text-red-600');
    });
});
