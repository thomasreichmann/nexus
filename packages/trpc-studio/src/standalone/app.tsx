import { createRoot } from 'react-dom/client';
import { TRPCStudio } from '../components/studio';
import '../styles/globals.css';

declare global {
    interface Window {
        __TRPC_STUDIO_CONFIG__?: {
            schemaUrl: string;
            trpcUrl: string;
            headers?: Record<string, string>;
        };
    }
}

function App() {
    const config = window.__TRPC_STUDIO_CONFIG__;

    if (!config) {
        return (
            <div className="trpc-studio flex items-center justify-center h-screen bg-background text-foreground">
                <p className="text-destructive font-semibold">
                    Missing __TRPC_STUDIO_CONFIG__
                </p>
            </div>
        );
    }

    return (
        <TRPCStudio
            schemaUrl={config.schemaUrl}
            trpcUrl={config.trpcUrl}
            headers={config.headers}
        />
    );
}

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App />);
}
