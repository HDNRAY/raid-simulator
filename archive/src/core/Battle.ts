import { RealtimeCharacterInterface, RealtimeEnemyInterface } from "types/types";
import { Character } from "./Character";
import { EnemyObjectInterface, getEnemy } from "./Enemy";

export interface TimeUpdateProps {
    time: number,
    characters: Array<RealtimeCharacterInterface>,
    enemies: Array<RealtimeEnemyInterface>,
}

export class Battle {
    battleStarted = false;
    startTime?: number;
    enemies?: Array<EnemyObjectInterface>;
    mainCharacter?: Character;

    // constructor() { }

    setMainCharacter = () => {

    }

    initEnemies = (enemyIds: Array<string>) => {
        this.enemies = enemyIds.map(id => getEnemy(id));
    }
}

export const battle = new Battle()