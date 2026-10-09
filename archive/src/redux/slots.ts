import { createSlice } from "@reduxjs/toolkit";
import { Slot } from "types/types";

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
        triggerSharedCooldown: (state, { payload }) => {
            state.sharedCooldownTriggerTime = payload;
        },
        setupSlots: (state, { payload }) => {
            state.slots = payload;
        }
    }
})

export const { setupSlots, triggerSharedCooldown } = slotsSlice.actions
export default slotsSlice.reducer