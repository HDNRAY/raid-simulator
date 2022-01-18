

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { skillMap } from "data/skills";
import { Character, RealtimeCharacter, CharacterResource, TargetType, OverTimeEffect } from "types/types";

interface CharacterState {
    mainCharacter?: RealtimeCharacter,
    target?: {
        type: TargetType,
        id: string
    } | Array<{
        type: TargetType,
        id: string
    }>
}

const initialState: CharacterState = {

}

const characterSlice = createSlice({
    name: 'character',
    initialState,
    reducers: {
        setMainCharacter: (state, { payload }: PayloadAction<Character>) => {
            const { staticAttributes, staticResources: staticResource, staticEnhancements } = payload
            state.mainCharacter = {
                ...payload,
                resources: {
                    ...staticResource,
                    fury: 0
                },
                availableResources: {
                    ...staticResource
                },
                attributes: staticAttributes,
                enhancements: staticEnhancements,
                overTimeEffects: []
            };
        },
        setTarget: (state, { payload }) => {
            state.target = payload;
        },
        triggerSkillCooldown: (state, { payload }) => {
            const { skillId, time } = payload;
            const skill = state.mainCharacter?.skills.find(s => s.skillId === skillId)
            if (skill) {
                skill.lastTriggerTime = time;
            }
        },
        startCasting: (state, { payload }) => {
            const { skillId, time, castTime } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.castingSkillId = skillId;
                character.castingTime = time;
                character.castTime = castTime
            }
        },
        doneCasting: (state) => {
            const character = state.mainCharacter;
            if (character) {
                character.castingSkillId = undefined;
                character.castingTime = undefined;
                character.castTime = 0;
            }
        },
        cancelCasting: (state) => {
            const character = state.mainCharacter;
            if (character) {
                character.castingSkillId = undefined;
                character.castingTime = undefined;
                character.castTime = 0;
            }
        },
        costOnCharacter: (state, { payload }: PayloadAction<{
            type: CharacterResource,
            value: number
        }>) => {
            const { type, value } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.resources[type] -= value;
            }
        },
        updateCost: (state, { payload }: PayloadAction<{
            type: CharacterResource,
            value: number
        }>) => {
            const { type, value } = payload;
            const character = state.mainCharacter;
            if (character) {
                character.resources[type] = Math.round(value);
            }
        },
        recoverCost: (state, { payload }: PayloadAction<{
            type: CharacterResource,
            value: number
        }>) => {
            const { type, value } = payload;
            const character = state.mainCharacter;
            if (character) {
                const newValue = character.resources[type] + value;
                character.resources[type] = Math.min(character.availableResources[type], Math.round(newValue));
            }
        },
        addCharacterOverTimeEffect: (state, { payload }) => {
            const { effectId, skillId, startTime, caster, interval } = payload;
            const target = state.mainCharacter;
            if (target) {
                const existIndex = target.overTimeEffects.findIndex(i => i.effectId === effectId);
                if (existIndex > -1) {
                    target.overTimeEffects.splice(existIndex, 1);
                }
                target.overTimeEffects.push({
                    interval,
                    effectId,
                    skillId,
                    lastTriggerTime: startTime,
                    startTime,
                    caster
                })
            }
        },
        updateCharacterOverTimeEffect: (state, { payload }) => {
            const { effectId, skillId, time } = payload;
            const target = state.mainCharacter;
            if (target) {
                const effect = target.overTimeEffects.find(i => i.skillId === skillId && i.effectId === effectId);
                if (effect) {
                    effect.lastTriggerTime = time;
                }
            }
        },
        removeCharacterOverTimeEffect: (state, { payload }) => {
            const { effectId } = payload;
            const target = state.mainCharacter;
            if (target) {
                const index = target.overTimeEffects.findIndex(i => i.effectId === effectId);
                target.overTimeEffects.splice(index, 1);
            }
        },
        computeBuffs: (state, { payload }: PayloadAction<Array<any>>) => {
            const character = state.mainCharacter;
            if (!character) {
                return;
            }

            payload.forEach(overTimeEffect => {
                const { skillId, effectId, caster } = overTimeEffect;
                const skill = skillMap[skillId];
                const effect = skill.effects.find(i => i.id === effectId) as OverTimeEffect;
                const { on, value } = effect;
                const effectValue = typeof value === 'number' ? value : value({
                    effect,
                    skill,
                    caster
                });
                if (on === 'haste') {
                    character.enhancements.haste = Math.min(0.5, character.enhancements.haste + effectValue);
                }
            })
        }
    }
})

export const { setMainCharacter, setTarget,
    triggerSkillCooldown, startCasting, doneCasting, cancelCasting,
    costOnCharacter, updateCost, recoverCost,
    addCharacterOverTimeEffect, updateCharacterOverTimeEffect, removeCharacterOverTimeEffect, computeBuffs
} = characterSlice.actions
export default characterSlice.reducer