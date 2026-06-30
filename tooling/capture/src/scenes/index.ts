import type { Scene } from '../scene';
import filesWalkthrough from './files-walkthrough';

/** Every recordable scene. Add a new scene file and list it here. */
export const scenes: Scene[] = [filesWalkthrough];

export function findScene(name: string): Scene | undefined {
    return scenes.find((scene) => scene.name === name);
}
