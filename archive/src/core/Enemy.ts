import { enemyData } from "data/enemies";
import { CharacterAttributes, CharacterEnhancements, CharacterResources, EnemyInterface, RealtimeEnemyInterface } from "types/types";
import { TimeUpdateProps } from "./Battle";

export interface EnemyObjectInterface extends EnemyInterface {
    onTimeUpdate: (props: TimeUpdateProps) => RealtimeEnemyInterface,
    onInitialize: () => RealtimeEnemyInterface
}

export class FirstEnemy implements EnemyObjectInterface {
    id = '0001'
    name: string
    staticResources: CharacterResources
    staticAttributes: CharacterAttributes
    staticEnhancements: CharacterEnhancements

    constructor(props: any) {
        this.name = props.name
        this.staticResources = props.staticResources
        this.staticAttributes = props.staticAttributes
        this.staticEnhancements = props.staticEnhancements
    }

    onTimeUpdate = (props: TimeUpdateProps) => {
        return {} as RealtimeEnemyInterface
    }

    onInitialize = () => {
        const { staticAttributes, staticResources, staticEnhancements, id, name } = this;
        return {
            id,
            name,
            staticAttributes,
            staticResources,
            staticEnhancements,
            resources: {
                ...staticResources,
                fury: 0
            },
            availableResources: {
                ...staticResources
            },
            attributes: staticAttributes,
            enhancements: staticEnhancements,
            overTimeEffects: []
        }
    }
}

export const getEnemy = (id: string) => {
    const data = enemyData.find(i => i.id === id);
    if (id === '0001') {
        return new FirstEnemy(data)
    } else {
        return new FirstEnemy(data)
    }
}