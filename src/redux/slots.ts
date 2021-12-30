import { createSlice } from "@reduxjs/toolkit";
import { slots } from "data/slots";
import { Skill } from "./skill";

export interface Slot {
    // id: number
    key?: string,
    link?: {
        type: 'skill',
        id: string,
        skill?: Skill
    }
}

interface SlotsState {
    slots: Array<Slot>,
    sharedCooldownTriggerTime?: number,
    sharedCooldown: number
}

const initialState: SlotsState = {
    sharedCooldownTriggerTime: undefined,
    sharedCooldown: 1000,
    slots: []
}

const slotsSlice = createSlice({
    name: 'slots',
    initialState,
    reducers: {
        triggerSharedCooldown: (state) => {
            state.sharedCooldownTriggerTime = new Date().getTime();
        },
        initSlots: (state) => {
            state.slots = slots as Array<Slot>;
        }
    }
})

export const { initSlots, triggerSharedCooldown } = slotsSlice.actions
export default slotsSlice.reducer