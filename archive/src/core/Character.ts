import { CharacterAttributes, CharacterEnhancements, CharacterInterface, CharacterResources, CharacterSkill, RealtimeCharacterInterface, RealtimeCharacterObject, Slot } from "types/types";
import { TimeUpdateProps } from "./Battle";

export interface CharacterObjectInterface extends CharacterInterface {
    onTimeUpdate: (props: TimeUpdateProps) => RealtimeCharacterInterface,
    onInitialize: () => RealtimeCharacterInterface
}

export class Character implements CharacterObjectInterface {

    id: string;
    name: string;
    staticResources: CharacterResources;
    staticAttributes: CharacterAttributes;
    staticEnhancements: CharacterEnhancements;

    resources: CharacterResources;
    availableResources: CharacterResources;
    attributes: CharacterAttributes;
    enhancements: CharacterEnhancements;

    skills: CharacterSkill[];
    slots: Slot[];

    castingSkillId?: string | undefined;
    castingTime?: number | undefined;
    castTime?: number | undefined;

    overTimeEffects: { effectId: string; skillId: string; lastTriggerTime: number; interval: number; startTime: number; caster: RealtimeCharacterObject; }[] = [];

    constructor(character: CharacterInterface) {
        const { staticAttributes, staticResources, staticEnhancements, id, name, skills, slots } = character
        this.id = id;
        this.name = name;

        this.staticResources = staticResources;
        this.staticAttributes = staticAttributes;
        this.staticEnhancements = staticEnhancements;

        this.resources = {
            ...staticResources,
            fury: 0
        }

        this.availableResources = {
            ...staticResources
        }

        this.attributes = {
            ...staticAttributes
        }
        this.enhancements = {
            ...staticEnhancements
        };

        this.skills = skills;
        this.slots = slots;
    }
    onTimeUpdate(props: TimeUpdateProps) {
        return {} as RealtimeCharacterInterface
    };
    onInitialize() {
        return {} as RealtimeCharacterInterface
    };;
}