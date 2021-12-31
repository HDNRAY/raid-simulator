import { createSlice } from "@reduxjs/toolkit";

interface universalState {
    time: number
}

const initialState: universalState = {
    time: 0
}

const slotsSlice = createSlice({
    name: 'universal',
    initialState,
    reducers: {
        updateTime: (state, { payload }) => {
            state.time = payload;
        }
    }
})

export const { updateTime } = slotsSlice.actions
export default slotsSlice.reducer