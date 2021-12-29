import { createSlice } from "@reduxjs/toolkit";
import { Skill } from "./skill";

export interface Slot {
    // id: number
    key?: string,
    link?: {
        type: 'skill',
        id: string
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
            state.slots = [{
                key: '1',
                link: {
                    type: 'skill',
                    id: '1'
                }
            }, {
                key: '2'
            }, {
                key: '3'
            }, {
                key: '4'
            }, {
                key: 'Q'
            }, {
                key: ''
            }, {
                key: ''
            }, {
                key: ''
            }, {
                key: ''
            }, {
                key: ''
            }]
        }
    }
})

export const { initSlots, triggerSharedCooldown } = slotsSlice.actions
export default slotsSlice.reducer