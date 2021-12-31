

import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Skill } from "./skill";

export interface CharacterResource {
    health: number,
    mana: number,
    energy: number,
    fury: number,
}

export interface CharacterAttributes {
    strength: number,
    agility: number,
    intelligence: number,
    spirit: number,
}

export interface Character {
    id: string,
    name: string,
    castingSkill?: Skill,
    castingTime?: number,
    staticResource: CharacterResource,
    realtimeResource?: CharacterResource,
    staticAttributes: CharacterAttributes,
    realtimeAttributes?: CharacterAttributes
}

interface CharacterState {
    mainCharacter?: Character,
}

const initialState: CharacterState = {

}

const characterSlice = createSlice({
    name: 'character',
    initialState,
    reducers: {
        setMainCharacter: (state, { payload }: PayloadAction<Character>) => {
            const { staticAttributes, staticResource } = payload
            const { health, mana, energy } = staticResource;
            state.mainCharacter = {
                ...payload,
                realtimeResource: {
                    health,
                    mana,
                    energy,
                    fury: 0
                },
                realtimeAttributes: staticAttributes
            };
        }
    }
})

export const { setMainCharacter } = characterSlice.actions
export default characterSlice.reducer