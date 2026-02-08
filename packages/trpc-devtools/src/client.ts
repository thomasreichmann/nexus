// Styles
import './styles/globals.css';

// Client exports
export { TRPCDevtools, type TRPCDevtoolsProps } from './components/devtools';

// Re-export UI components for customization
export {
    Button,
    Input,
    Textarea,
    Card,
    CardHeader,
    CardContent,
    CardFooter,
    CardTitle,
    CardDescription,
    Badge,
    ScrollArea,
} from './components/ui';

// Utilities
export { cn } from './lib/utils';
export {
    executeRequest,
    type TRPCRequest,
    type TRPCResponse,
} from './lib/request';
export {
    loadHistory,
    saveToHistory,
    clearHistory,
    type HistoryItem,
} from './lib/storage';
