import { createSlice } from "@reduxjs/toolkit";

interface universalState {
    time: number
}

const initialState: universalState = {
    time: new Date().getTime()
}

const slotsSlice = createSlice({
    name: 'universal',
    initialState,
    reducers: {
        updateTime: (state) => {
            state.time = new Date().getTime();
        }
    }
})

export const { updateTime } = slotsSlice.actions
export default slotsSlice.reducer