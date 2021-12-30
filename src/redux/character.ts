

import { createSlice } from "@reduxjs/toolkit";
import { v4 as uuid } from 'uuid';

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
    staticResource: CharacterResource,
    realtimeResource: CharacterResource,
    staticAttributes: CharacterAttributes,
    realtimeAttributes: CharacterAttributes
}

interface CharacterState {
    characters: Array<Character>
}

const initialState: CharacterState = {
    characters: []
}

const characterSlice = createSlice({
    name: 'character',
    initialState,
    reducers: {
        addCharacter: (state, { payload }) => {
            state.characters.push({
                id: uuid(),
                ...payload
            });
        }
    }
})

export const { addCharacter } = characterSlice.actions
export default characterSlice.reducer