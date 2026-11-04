import filesStill from './files-still';
import filesWalkthrough from './files-walkthrough';
import type { Scene } from '../scene';

/** Every recordable scene. Add a new scene file and list it here. */
export const scenes: Scene[] = [filesWalkthrough, filesStill];

export function findScene(name: string): Scene | undefined {
    return scenes.find((scene) => scene.name === name);
}
