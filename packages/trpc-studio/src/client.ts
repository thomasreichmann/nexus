// Styles
import './styles/globals.css';

// Client exports
export { TRPCStudio, type TRPCStudioProps } from './components/studio';

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
