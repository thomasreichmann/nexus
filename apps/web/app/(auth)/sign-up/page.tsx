import Link from 'next/link';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { Shield, DollarSign, Archive } from 'lucide-react';

export default function SignUpPage() {
    return (
        <div className="mx-auto w-full max-w-md">
            <div className="mb-8 text-center">
                <h1 className="mb-2 text-2xl font-bold">Create your account</h1>
                <p className="text-muted-foreground">
                    Start storing your files securely for less
                </p>
            </div>
            <SignUpForm />
            <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                    href="/sign-in"
                    className="font-medium text-primary hover:underline"
                >
                    Sign in
                </Link>
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-primary" />
                    <span>5 GB free</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <span>Encrypted</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <Archive className="h-3.5 w-3.5 text-primary" />
                    <span>No credit card</span>
                </div>
            </div>
        </div>
    );
}
