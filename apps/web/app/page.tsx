import { Fraunces } from 'next/font/google';
import { Header } from '@/components/landing/header';
import { Hero } from '@/components/landing/hero';
import { ProblemSolution } from '@/components/landing/problem-solution';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Features } from '@/components/landing/features';
import { Pricing } from '@/components/landing/pricing';
import { Trust } from '@/components/landing/trust';
import { CTA } from '@/components/landing/cta';
import { Footer } from '@/components/landing/footer';

const fraunces = Fraunces({
    subsets: ['latin'],
    style: ['normal', 'italic'],
    axes: ['opsz'],
    variable: '--font-fraunces',
    display: 'swap',
});

export default function LandingPage() {
    return (
        <div
            className={`${fraunces.variable} landing flex min-h-screen scroll-smooth flex-col`}
        >
            <Header />
            <main className="flex-1">
                <Hero />
                <ProblemSolution />
                <HowItWorks />
                <Features />
                <Pricing />
                <Trust />
                <CTA />
            </main>
            <Footer />
        </div>
    );
}
